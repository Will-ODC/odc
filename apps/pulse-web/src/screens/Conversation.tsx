import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button } from "../components/Button.js";
import { useSuggestedVotes } from "../hooks/use-suggested-votes.js";
import type { Ballot, MyVote, Poll, PulseApi, Results } from "../api/types.js";
import { ApiError, UNREACHABLE } from "../api/types.js";
import type { Route } from "../flow/route.js";
import { cardStatus, closingNote, nextFor } from "../flow/conversation.js";
import { byline } from "../flow/new-poll.js";
import { pathOf } from "../flow/route.js";
import {
  answeredList,
  nextCloseAt,
  type MyVotesPlace,
} from "../flow/answered.js";
import { useRedrawAt } from "../hooks/use-redraw-at.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import type { CastState } from "../hooks/use-cast-vote.js";
import { useClosedResults } from "../hooks/use-closed-results.js";
import { usePublicVotes } from "../hooks/use-public-votes.js";
import { useFreshResults } from "../hooks/use-fresh-results.js";
import { useMyVotes, useMyVotesPlace } from "../hooks/use-my-votes.js";
import { useWide } from "../hooks/use-wide.js";
import { useSwipeLeft } from "../hooks/use-swipe.js";
import { votePrivacyNote, type Confirmation } from "../flow/vote-card.js";
import { PublicVotes } from "../components/PublicVotes.js";
import { TwoPress, type TwoPressProgress } from "../components/TwoPress.js";
import { VoteCard } from "../components/VoteCard.js";
import { ClosedResults } from "../components/ClosedResults.js";
import { ViewState } from "../components/ViewState.js";
import { SuggestedVotesRail } from "../components/SuggestedVotesRail.js";
import { AnsweredRail } from "../components/AnsweredRail.js";
import { PostedBanner } from "../components/PostedBanner.js";
import { CopyLink } from "../components/CopyLink.js";
import { QuestionPicture } from "../components/QuestionPicture.js";
import {
  QuestionPager,
  type MyVotesNavigation,
} from "../components/QuestionPager.js";
import { useSession } from "../hooks/use-session.js";
import type { Session } from "../hooks/use-session.js";
import { SiteBanner } from "../components/SiteBanner.js";
import "./Conversation.css";

/**
 * `stale` when someone signed in after these results were fetched: the vote
 * is now confirmed (ADR-0040) and the confirmed number shown with it is not.
 * Revisiting the question asks for fresh ones.
 */
type Answer = {
  poll: Poll;
  ballot: number[];
  results: Results;
  stale?: boolean;
};

/** What the vote card can say about confirmation, from who is signed in. */
function confirmationOf(session: Session): Confirmation {
  switch (session.status) {
    case "signedIn":
      return "confirmed";
    case "signedOut":
      return "offer";
    // The server could not say: offer nothing rather than a sign-in that may
    // be unnecessary. Coming back to the page asks again (`useSession`).
    case "unknown":
    case "loading":
      return "unknown";
  }
}

/** Hands the page a send and the promise of how it ends. */
type VoteUpdate = CastState | { status: "removed" };
type Sent = (poll: Poll, outcome: Promise<VoteUpdate>) => void;

type QuestionIdentity = {
  session: Session;
  recheck: ReturnType<typeof useSession>["recheck"];
  onAccountChanged: (pollId: string) => void;
  onPollLoaded: (poll: Poll | null) => void;
};

/** Whether a poll's closing time has passed, by this browser's clock. */
function hasClosed(poll: Poll): boolean {
  return poll.closesAt !== null && Date.parse(poll.closesAt) <= Date.now();
}

function sameBallot(a: Ballot, b: Ballot): boolean {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return (
    left.length === right.length && left.every((one, i) => one === right[i])
  );
}

/** This browser's saved answer to `poll` and its results, if it has one. */
async function savedAnswer(
  api: PulseApi,
  poll: Poll,
): Promise<Answer | undefined> {
  try {
    const ballot = await api.myBallot(poll.id);
    if (!ballot || ballot.length === 0) return undefined;
    return { poll, ballot: [...ballot], results: await api.results(poll.id) };
  } catch {
    return undefined;
  }
}

/**
 * How long a question waits for its saved answer before it is asked anyway.
 * A stalled read must not leave a question that has loaded on "Loading…".
 */
const RESTORE_WAIT_MS = 5000;

/**
 * A whole run stays in one conversation; only its active card changes.
 *
 * Opening another question with Next, from the rail, or by going Back keeps
 * this conversation on screen: App does not remount it per question, and the
 * question shown follows `pollId` when the address changes (#488).
 */
export function Conversation({
  api,
  pollId,
  onNavigate,
  onSignedOut,
  posted,
}: {
  api: PulseApi;
  pollId: string;
  /** Pushes a question onto browser history so its address can be shared. */
  onNavigate?: (to: Route) => void;
  /** Runs once the server has signed this person out everywhere. */
  onSignedOut?: (stayOnPoll: boolean) => void;
  /**
   * Set only right after this question was posted from this browser: shows
   * "Your question is live · Copy link" until dismissed.
   */
  posted?: { url: string; onDismiss: () => void };
}) {
  const [at, setAt] = useState(pollId);
  const [answers, setAnswers] = useState<Answer[]>([]);
  // Questions with an answer being sent, until the send settles. Each send's
  // outcome reaches this page from the send itself, not from its card, so a
  // send whose card has gone still updates the list (#488).
  const [sending, setSending] = useState<readonly string[]>([]);
  // Sent questions that were left before the send settled. Until it does,
  // what this page holds for one may be the answer it replaced: the rail
  // keeps that row in its place, but the question does not claim it.
  const [unsettled, setUnsettled] = useState<readonly string[]>([]);
  // The rail and the question links wait only for the question on screen.
  const busy = sending.includes(at) && !unsettled.includes(at);
  // The address changed (Next, a rail row, or Back and Forward): show it.
  // Not when it names the question already shown: nothing is
  // left then, and a send on it still holds the rail.
  const [routed, setRouted] = useState(pollId);
  if (routed !== pollId) {
    setRouted(pollId);
    if (at !== pollId) {
      setAt(pollId);
      if (busy) setUnsettled((old) => [...old, at]);
    }
  }
  // Bumped when a send left behind settles while its question is on screen
  // again, so the question is drawn afresh with the outcome.
  const [settledAgain, setSettledAgain] = useState(0);
  // Poll ids cast or changed during this visit, oldest first. Restoring a
  // saved answer does not add it here.
  const [recentAnswers, setRecentAnswers] = useState<string[]>([]);
  // Whether this browser held a ballot before this visit. The ballot cookie
  // cannot be read from script, so the first question's ballot stands in.
  const [heldBefore, setHeldBefore] = useState(false);
  // Bumped when the votes are forgotten, so the question starts over.
  const [round, setRound] = useState(0);
  // This browser's saved answers, read on every visit, so the Answered list
  // survives navigation and reload (#484); this page's answers join it below.
  const mine = useMyVotes(api);
  const { clear: clearMine, retry: reloadMine } = mine;
  // Set by the rail's Try again, so a reload that ends well is read out too.
  const [railRetried, setRailRetried] = useState(false);
  // Counts forgettings, so a send from before one changes nothing after it.
  const generation = useRef(0);
  // Counts sends per question, so the server's answer to "which ballot do you
  // hold" changes nothing once a newer send for that question has started:
  // it may describe the server from before that send was stored (#519).
  const sends = useRef(new Map<string, number>());
  const stamp = useCallback(
    (id: string) => `${generation.current}:${sends.current.get(id) ?? 0}`,
    [],
  );
  const forgotten = useCallback(() => {
    generation.current += 1;
    setAnswers([]);
    setRecentAnswers([]);
    setSending([]);
    setUnsettled([]);
    setHeldBefore(false);
    setRailRetried(false);
    setAt(pollId);
    setRound((n) => n + 1);
    clearMine();
  }, [pollId, clearMine]);
  const currentPoll = useRef<Poll | null>(null);
  const pollLoaded = useCallback((poll: Poll | null) => {
    currentPoll.current = poll;
  }, []);
  // Signing out clears the ballot cookie (API.md), and the list with it.
  const signedOut = useCallback(() => {
    forgotten();
    onSignedOut?.(currentPoll.current?.votePrivacy === "public");
  }, [forgotten, onSignedOut]);
  const [accountChangedAt, setAccountChangedAt] = useState<string | null>(null);
  const { session, progress, signOut, dismiss, recheck } = useSession(api, {
    onSignedOut: signedOut,
    onForgotten: forgotten,
    watchSignOut: true,
  });
  const remembered = useCallback((answer: Answer) => {
    setAnswers((old) =>
      old.some((one) => one.poll.id === answer.poll.id)
        ? old.map((one) => (one.poll.id === answer.poll.id ? answer : one))
        : [...old, answer],
    );
  }, []);
  const foundHeldBallot = useCallback(() => setHeldBefore(true), []);
  const counted = useCallback(
    (answer: Answer) => {
      remembered(answer);
      setRecentAnswers((old) => [
        ...old.filter((id) => id !== answer.poll.id),
        answer.poll.id,
      ]);
    },
    [remembered],
  );
  // Read by a send's outcome, which arrives after the render that sent it.
  const latest = useRef({ at, answers, unsettled });
  useLayoutEffect(() => {
    latest.current = { at, answers, unsettled };
  });
  // After a lost connection the answer may have been stored: ask the server
  // which one it holds, and list that one. A changed one counts as a cast.
  // Undefined when the server could not say, the votes were forgotten, the
  // question was sent again while it was asked, or the asker gave up waiting
  // (`signal`), so a late reply changes nothing on screen (#557).
  const readBack = useCallback(
    async (poll: Poll, signal?: AbortSignal): Promise<Answer | undefined> => {
      const askedAt = stamp(poll.id);
      const found = await savedAnswer(api, poll);
      if (!found || signal?.aborted || stamp(poll.id) !== askedAt)
        return undefined;
      const before = latest.current.answers.find(
        (one) => one.poll.id === poll.id,
      );
      if (before && sameBallot(before.ballot, found.ballot)) remembered(found);
      else counted(found);
      return found;
    },
    [api, counted, remembered, stamp],
  );
  const sent = useCallback(
    (poll: Poll, outcome: Promise<VoteUpdate>) => {
      const sentIn = generation.current;
      const current = () => generation.current === sentIn;
      sends.current.set(poll.id, (sends.current.get(poll.id) ?? 0) + 1);
      setSending((old) => [...old, poll.id]);
      void outcome.then(async (state) => {
        if (!current()) return;
        // This send's entry only. A second send for a question whose first
        // is still out is never offered (`useRestoredAnswer`'s stillSending).
        setSending((old) => {
          const one = old.indexOf(poll.id);
          return one < 0 ? old : [...old.slice(0, one), ...old.slice(one + 1)];
        });
        const left = latest.current.unsettled.includes(poll.id);
        if (state.status === "counted")
          counted({ poll, ballot: state.ballot, results: state.results });
        else if (state.status === "removed") {
          setAnswers((old) => old.filter((one) => one.poll.id !== poll.id));
          setRecentAnswers((old) => old.filter((id) => id !== poll.id));
          clearMine();
          reloadMine();
        } else if (left && state.status === "failed" && !state.refused) {
          // The connection was lost: the answer may have been stored. Ask.
          await readBack(poll);
          if (!current()) return;
        }
        if (!left) return;
        setUnsettled((old) => old.filter((id) => id !== poll.id));
        if (latest.current.at === poll.id) setSettledAgain((n) => n + 1);
      });
    },
    [clearMine, counted, readBack, reloadMine],
  );
  // Whether the question on screen was reached with the browser's Back (or
  // Forward): it fades in rather than sliding in from the right (#560).
  const [cameBack, setCameBack] = useState(false);
  useEffect(() => {
    const onPop = () => setCameBack(true);
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);
  // Every question link, including Next, follows the rail's history path
  // (#502). Open locally too for callers without a router; do not push when
  // the address already names the question.
  const go = (id: string) => {
    if (busy || id === at) return;
    setCameBack(false);
    setAccountChangedAt(null);
    setAt(id);
    if (id !== pollId) onNavigate?.({ kind: "conversation", pollId: id });
  };
  // Signing in confirms every vote already given here, so every result already
  // shown is missing it from the confirmed number.
  const previousSession = useRef(session);
  useEffect(() => {
    const before = previousSession.current;
    previousSession.current = session;
    if (
      session.status === "signedIn" &&
      (before.status !== "signedIn" || before.me.id !== session.me.id)
    ) {
      if (before.status !== "loading") reloadMine();
      setAnswers((old) => old.map((one) => ({ ...one, stale: true })));
    }
  }, [reloadMine, session]);
  // What the question may claim: not an answer whose change is still out.
  const settledAnswers = answers.filter(
    (one) => !unsettled.includes(one.poll.id),
  );
  const saved = settledAnswers.find((one) => one.poll.id === at);
  const firstPage = mine.data.status === "ready" ? mine.data.value : undefined;
  // The rail draws the first page and this page's answers, nothing more.
  const answered = answeredList(firstPage?.votes ?? [], answers, recentAnswers);
  // A row whose question closes while this page is open says so then (#589).
  useRedrawAt(nextCloseAt(answered));
  // Previous and Next follow My votes (#528).
  const place = useMyVotesPlace({
    api,
    first: firstPage,
    firstLoading: mine.data.status === "loading",
    answers,
    recent: recentAnswers,
    at,
    round,
  });
  const main = useRef<HTMLElement>(null);
  // "Your question is live" belongs to the question just posted. Leaving it
  // for another question ends the line.
  const leftPosted = posted !== undefined && at !== pollId;
  const dismissPosted = posted?.onDismiss;
  useEffect(() => {
    if (leftPosted) dismissPosted?.();
  }, [leftPosted, dismissPosted]);
  const suggestions = useSuggestedVotes({
    api,
    history: mine.data,
    retryHistory: mine.retry,
    justAnswered: answered,
  });
  return (
    <div className="conversation with-suggested-votes">
      <header className="conversation__banner">
        <SiteBanner
          session={session}
          progress={progress}
          holdsVotes={
            heldBefore || answered.length > 0 || mine.data.status === "ready"
          }
          {...(mine.voteRead ? { voteRead: mine.voteRead } : {})}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
      <AnsweredRail
        className="conversation__sidebar"
        data={mine.data}
        votes={answered}
        current={at}
        disabled={busy}
        onOpen={go}
        railRetried={railRetried}
        onRetry={() => {
          setRailRetried(true);
          mine.retry();
        }}
      />
      <main
        className={`conversation__main${cameBack ? " conversation__main--back" : ""}`}
        ref={main}
      >
        {posted && at === pollId ? (
          <PostedBanner
            url={posted.url}
            onDismiss={() => {
              // The line is gone; the question it sat over takes focus.
              main.current?.querySelector<HTMLElement>("h1")?.focus();
              posted.onDismiss();
            }}
          />
        ) : null}
        <div
          aria-live="polite"
          role={accountChangedAt === at ? "status" : undefined}
        >
          {accountChangedAt === at
            ? "Your account changed. Check your answer before trying again."
            : null}
        </div>
        <Question
          key={`${round}:${at}:${settledAgain}`}
          api={api}
          pollId={at}
          {...(saved ? { saved } : {})}
          waiting={unsettled.includes(at)}
          identity={{
            session,
            recheck,
            onAccountChanged: setAccountChangedAt,
            onPollLoaded: pollLoaded,
          }}
          onRemembered={remembered}
          onReadBack={readBack}
          onHeldBallot={foundHeldBallot}
          onSent={sent}
          onGo={go}
          myVotesPlace={place}
          // The posting banner already offers Copy link; one is enough.
          shareable={!(posted && at === pollId)}
        />
      </main>
      <SuggestedVotesRail
        {...suggestions}
        current={at}
        disabled={busy}
        onOpen={go}
      />
    </div>
  );
}
function Question({
  api,
  pollId,
  saved,
  waiting,
  identity,
  onRemembered,
  onReadBack,
  onHeldBallot,
  onSent,
  onGo,
  myVotesPlace,
  shareable,
}: {
  api: PulseApi;
  pollId: string;
  saved?: Answer;
  waiting: boolean;
  identity: QuestionIdentity;
  onRemembered: (answer: Answer) => void;
  /**
   * Asks the server which answer it holds for a poll, and lists it, unless
   * `signal` was aborted before the reply came.
   */
  onReadBack: (poll: Poll, signal?: AbortSignal) => Promise<Answer | undefined>;
  onHeldBallot: () => void;
  onSent: Sent;
  onGo: (id: string) => void;
  myVotesPlace: MyVotesPlace;
  shareable: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  // Retrying remounts the loader so usePoll's request cleanup discards stale results.
  return (
    <LoadedQuestion
      key={attempt}
      api={api}
      pollId={pollId}
      {...(saved ? { saved } : {})}
      waiting={waiting}
      identity={identity}
      onRemembered={onRemembered}
      onReadBack={onReadBack}
      onHeldBallot={onHeldBallot}
      onSent={onSent}
      onGo={onGo}
      myVotesPlace={myVotesPlace}
      shareable={shareable}
      onRetry={() => setAttempt((one) => one + 1)}
    />
  );
}

function LoadedQuestion({
  api,
  pollId,
  saved,
  waiting,
  identity,
  onRemembered,
  onReadBack,
  onHeldBallot,
  onSent,
  onGo,
  myVotesPlace,
  shareable,
  onRetry,
}: {
  api: PulseApi;
  pollId: string;
  saved?: Answer;
  /** A send left behind for this question has not settled yet. */
  waiting: boolean;
  identity: QuestionIdentity;
  onRemembered: (answer: Answer) => void;
  /**
   * Asks the server which answer it holds for a poll, and lists it, unless
   * `signal` was aborted before the reply came.
   */
  onReadBack: (poll: Poll, signal?: AbortSignal) => Promise<Answer | undefined>;
  onHeldBallot: () => void;
  onSent: Sent;
  onGo: (id: string) => void;
  myVotesPlace: MyVotesPlace;
  /** Whether to offer Copy link under the question. */
  shareable: boolean;
  onRetry: () => void;
}) {
  const fetched = usePoll(api, pollId);
  const poll = fetched.status === "ready" ? fetched.value : null;
  const { session, onPollLoaded } = identity;
  useLayoutEffect(() => {
    onPollLoaded(poll);
    return () => onPollLoaded(null);
  }, [poll, onPollLoaded]);
  // Anonymous ballots belong to the browser. Public ballots belong to the
  // signed-in account, and a sign-in starts a new restore for this poll.
  const ballotOwner =
    poll?.votePrivacy !== "public"
      ? false
      : session.status === "signedIn"
        ? session.me.id
        : null;
  const visibleSaved = ballotOwner === null ? undefined : saved;
  const restored = useRestoredAnswer(
    api,
    poll,
    visibleSaved,
    waiting,
    ballotOwner,
    onHeldBallot,
    onRemembered,
  );
  // The question is drawn with its saved answer or not at all, never first
  // unanswered and then answered a moment later.
  const loaded =
    fetched.status === "ready" && restored === "pending"
      ? { status: "loading" as const }
      : fetched;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Forget remounts this question to clear its saved answer. Loading it
    // again must not take focus from Sign in (or another header control).
    if (
      loaded.status === "ready" &&
      !document.activeElement?.closest(".banner")
    )
      heading.current?.focus();
  }, [loaded.status]);
  // On desktop (#490) voting sits in the page under the question; on a phone
  // it is the sheet along the bottom edge.
  const wide = useWide();
  const { scrollRef, dockRef } = useDockSpace();
  const renderPage = (
    standing: ReactNode,
    vote: ReactNode,
    pollClosed = false,
  ) => {
    return (
      <>
        <div className="conversation__scroll" ref={scrollRef}>
          <div className="conversation__column">
            <ViewState data={loaded} onRetry={onRetry}>
              {(poll) => {
                const note = closingNote(
                  { ...poll, open: poll.open && !pollClosed },
                  poll.votePrivacy !== "public" ||
                    session.status === "signedIn",
                );
                return (
                  // One heading node while the card opens and closes, so focus
                  // on it survives; it is drawn afresh once the poll loads.
                  <section className="conversation__hero">
                    {note ? <p>{note}</p> : null}
                    <h1 ref={heading} tabIndex={-1}>
                      {poll.question}
                    </h1>
                    <QuestionPicture
                      image={poll.image}
                      community={poll.community}
                    />
                    {poll.context ? (
                      <p className="conversation__context">{poll.context}</p>
                    ) : null}
                    {byline(poll.attribution) ? (
                      <p className="conversation__byline">
                        {byline(poll.attribution)}
                      </p>
                    ) : null}
                    {shareable ? (
                      <CopyLink
                        url={
                          new URL(
                            pathOf({ kind: "conversation", pollId: poll.id }),
                            window.location.href,
                          ).href
                        }
                        question={poll.question}
                      />
                    ) : null}
                  </section>
                );
              }}
            </ViewState>
            {loaded.status === "empty" ? (
              <Button
                variant="secondary"
                size="small"
                type="button"
                onClick={onRetry}
              >
                Try again
              </Button>
            ) : null}
            {wide && vote ? (
              <div className="conversation__vote conversation__vote--page">
                {vote}
              </div>
            ) : null}
            {standing ? (
              <div className="conversation__standing">{standing}</div>
            ) : null}
            {/*
              No list of earlier answers under the results (#478, operator
              2026-11-07): the Answered rail and the My votes tab carry them.
            */}
          </div>
        </div>
        {vote && !wide ? (
          <aside
            className="conversation__dock"
            aria-label="Voting"
            ref={dockRef}
          >
            <div className="conversation__column">
              <div className="conversation__vote">{vote}</div>
            </div>
          </aside>
        ) : null}
      </>
    );
  };
  if (loaded.status === "ready" && restored === "stillSending")
    // The question, but no card to answer it with: a second send would race
    // the one still out. The page draws it afresh once that one settles.
    return renderPage(
      null,
      <p className="conversation__pending" role="status">
        Your answer is still being sent.
      </p>,
    );
  return loaded.status === "ready" ? (
    <LiveCard
      key={ballotOwner || loaded.value.id}
      api={api}
      poll={loaded.value}
      {...(visibleSaved ? { saved: visibleSaved } : {})}
      identity={identity}
      onRemembered={onRemembered}
      onReadBack={onReadBack}
      onSent={onSent}
      onGo={onGo}
      myVotesPlace={myVotesPlace}
      wide={wide}
      renderPage={renderPage}
    />
  ) : (
    renderPage(null, null)
  );
}

/**
 * A saved answer from an earlier visit, put back on the page (#484).
 *
 * The page only knew answers given on this visit, so after a reload the
 * question asked again as if it had never been answered. Before the card is
 * drawn, this asks the server for this browser's ballot and, when there is
 * one, its results, and hands them on as if just counted. The card waits for
 * the answer, so it is drawn once, with the saved answer or without it.
 * Failing to ask is not an error the page shows: the question is drawn
 * unanswered, as it was before.
 *
 * While a send left behind for this question is still out (`waiting`), the
 * server's ballot may be about to change, so it is not asked for: the page
 * draws the question again once the send settles. After the same wait the
 * question is shown without a card to answer it (`stillSending`), never
 * unanswered with Submit: a second send would race the first (#488).
 */
function useRestoredAnswer(
  api: PulseApi,
  poll: Poll | null,
  saved: Answer | undefined,
  waiting: boolean,
  ballotOwner: string | false | null,
  onHeldBallot: () => void,
  onFound: (answer: Answer) => void,
): "pending" | "settled" | "stillSending" {
  const [settledFor, setSettledFor] = useState(saved ? ballotOwner : undefined);
  const settled = ballotOwner === null || settledFor === ballotOwner;
  const [slow, setSlow] = useState(false);
  const found = useRef(onFound);
  found.current = onFound;
  useEffect(() => {
    if (settled || !poll) return;
    let live = true;
    const finish = (answer?: Answer) => {
      if (!live) return;
      if (answer) {
        onHeldBallot();
        found.current(answer);
      }
      live = false;
      clearTimeout(giveUp);
      setSettledFor(ballotOwner);
    };
    // Bounded: a read that never answers asks the question unanswered, and
    // anything arriving after that is dropped by the cleanup below. The rail's
    // row is not used instead: it can be older than the server's ballot (a
    // change sent from another tab), and the question is honest unanswered.
    // Nothing here depends on the rail, so the rail loading or reloading
    // never restarts the wait or asks for the ballot twice.
    const giveUp = setTimeout(
      () => (waiting ? setSlow(true) : finish()),
      RESTORE_WAIT_MS,
    );
    if (!waiting)
      api
        .myBallot(poll.id)
        .then(async (ballot) => {
          if (!live) return;
          if (!ballot || ballot.length === 0) {
            finish();
            return;
          }
          onHeldBallot();
          finish({ poll, ballot, results: await api.results(poll.id) });
        })
        .catch(() => finish());
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [api, poll, settled, ballotOwner, waiting, onHeldBallot]);
  return settled ? "settled" : slow ? "stillSending" : "pending";
}

/**
 * Keeps the page's bottom space as tall as the open Voting drawer on a phone,
 * so everything under the question, the closed question's Previous and Next
 * too, can scroll clear of it. The drawer's height, which changes as it opens
 * and closes, is measured and handed to the CSS as `--dock-space`.
 */
function useDockSpace() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dockRef = useCallback((dock: HTMLElement | null) => {
    if (!dock) return;
    const fit = () =>
      scrollRef.current?.style.setProperty(
        "--dock-space",
        `${dock.getBoundingClientRect().height}px`,
      );
    fit();
    const watch =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    watch?.observe(dock);
    return () => {
      watch?.disconnect();
      scrollRef.current?.style.removeProperty("--dock-space");
    };
  }, []);
  return { scrollRef, dockRef };
}

/** A My votes row as one end of the pager, or a disabled end. */
function opener(
  row: MyVote | null,
  onGo: (id: string) => void,
): MyVotesNavigation["next"] {
  return row
    ? { question: row.question, onOpen: () => onGo(row.pollId) }
    : null;
}

function LiveCard({
  api,
  poll,
  saved,
  identity,
  onRemembered,
  onReadBack,
  onSent,
  onGo,
  myVotesPlace,
  wide,
  renderPage,
}: {
  api: PulseApi;
  poll: Poll;
  saved?: Answer;
  identity: QuestionIdentity;
  onRemembered: (answer: Answer) => void;
  /**
   * Asks the server which answer it holds for a poll, and lists it, unless
   * `signal` was aborted before the reply came.
   */
  onReadBack: (poll: Poll, signal?: AbortSignal) => Promise<Answer | undefined>;
  onSent: Sent;
  onGo: (id: string) => void;
  myVotesPlace: MyVotesPlace;
  /** The desktop layout (#490): voting in the page, no drawer. */
  wide: boolean;
  renderPage: (
    standing: ReactNode,
    vote: ReactNode,
    pollClosed?: boolean,
  ) => ReactNode;
}) {
  const publicPoll = poll.votePrivacy === "public";
  const { session, recheck, onAccountChanged } = identity;
  const confirmation = confirmationOf(session);
  const accountId = session.status === "signedIn" ? session.me.id : null;
  const closesAt =
    publicPoll && poll.closesAt ? Date.parse(poll.closesAt) : undefined;
  useRedrawAt(
    closesAt !== undefined && closesAt > Date.now() ? closesAt : undefined,
  );
  const [removalClosed, setRemovalClosed] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [removal, setRemoval] = useState<TwoPressProgress>({ status: "idle" });
  const { state, cast, reset } = useCastVote(
    api,
    poll.id,
    publicPoll ? true : undefined,
  );
  const [picked, setPicked] = useState<number[]>(saved?.ballot ?? []);
  const [showSaved, setShowSaved] = useState(Boolean(saved));
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  // Minimized results stay minimized while this question is on screen,
  // through a changed answer and fresh numbers (#478).
  const [resultsHidden, setResultsHidden] = useState(false);
  const show = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(true);
  const closed = useClosedResults(
    api,
    poll.id,
    !publicPoll || accountId !== null,
  );
  // The page learns the outcome from the send itself (`onSent`); the card
  // only keeps the counted ballot as its picks.
  const previous = useRef(state);
  useEffect(() => {
    if (state.status === "counted" && state !== previous.current)
      setPicked(state.ballot);
    previous.current = state;
  }, [state]);
  useEffect(() => {
    if (!visible) show.current?.focus();
    else if (!wasVisible.current) {
      const node = wrapper.current;
      (
        node?.querySelector<HTMLElement>("[role=group]") ??
        node?.querySelector<HTMLElement>("input:checked") ??
        node?.querySelector<HTMLElement>("input") ??
        node?.querySelector<HTMLElement>("button")
      )?.focus();
    }
    wasVisible.current = visible;
  }, [visible]);
  const pollClosed = removalClosed || (publicPoll && hasClosed(poll));
  const status = pollClosed
    ? { kind: "closed" as const }
    : cardStatus(poll, state);
  const ballot = state.status === "counted" ? state.ballot : picked;
  const fresh = useFreshResults(api, poll.id, (results) =>
    onRemembered({ poll, ballot, results }),
  );
  const { refresh: refreshResults } = fresh;
  const answered =
    status.kind === "answered" || (status.kind === "answerable" && showSaved);
  // Signed in while this card shows a counted vote: the vote is confirmed
  // now, and the numbers on screen do not include it yet.
  const was = useRef(confirmation);
  useEffect(() => {
    if (
      was.current !== "confirmed" &&
      confirmation === "confirmed" &&
      answered &&
      !hasClosed(poll)
    )
      refreshResults();
    was.current = confirmation;
  }, [confirmation, answered, refreshResults, poll]);
  /*
   * Signing in after the question closed confirms nothing (ADR-0040), so the
   * card stops offering and does not claim it either. Decided while
   * rendering, not in an effect, so "confirmed by email" is never drawn even
   * for one frame.
   */
  const [seen, setSeen] = useState(confirmation);
  const [lateSignIn, setLateSignIn] = useState(false);
  if (seen !== confirmation) {
    setSeen(confirmation);
    if (seen !== "confirmed" && confirmation === "confirmed" && answered)
      if (hasClosed(poll)) setLateSignIn(true);
  }
  const cardConfirmation: Confirmation = lateSignIn ? "unknown" : confirmation;
  // A saved answer from before someone signed in, revisited.
  const staleOnArrival = useRef(Boolean(saved?.stale && showSaved));
  useEffect(() => {
    if (staleOnArrival.current) refreshResults();
  }, [refreshResults]);
  const savedShowing =
    status.kind === "answerable" && showSaved && saved
      ? { kind: "answered" as const, results: saved.results, changed: false }
      : status;
  const showing =
    savedShowing.kind === "answered" && fresh.results
      ? { ...savedShowing, results: fresh.results }
      : savedShowing;
  const resultView = showing.kind === "answered";
  const hadResults = useRef(resultView);
  // Set by Close on desktop, so focus goes back to "Change my answer".
  const backedOut = useRef(false);
  // The one place focus follows results in and out of the page. Backing out
  // of a change closes the drawer, and focus stays on its handle instead.
  // On desktop (#490) the answer folds into the "You picked" line, which
  // takes focus, or its "Change my answer" after Close.
  useEffect(() => {
    if (
      visible &&
      ((resultView && document.activeElement === document.body) ||
        hadResults.current !== resultView)
    ) {
      const node = wrapper.current;
      const target = !resultView
        ? (node?.querySelector<HTMLElement>("input:checked") ??
          node?.querySelector<HTMLElement>("input"))
        : !wide
          ? node?.querySelector<HTMLElement>(".results")
          : backedOut.current
            ? node?.querySelector<HTMLElement>(".vote-card__change")
            : node?.querySelector<HTMLElement>(".vote-card__yours");
      target?.focus();
    }
    backedOut.current = false;
    hadResults.current = resultView;
  }, [resultView, saved, visible, wide]);
  const shut = status.kind === "closed";
  const wasShut = useRef(shut);
  const { retry: reloadStanding } = closed;
  const showingCachedStanding =
    closed.showing && closed.data.status === "ready";
  useEffect(() => {
    if (!wasShut.current && shut && publicPoll && showingCachedStanding)
      reloadStanding();
    wasShut.current = shut;
  }, [shut, publicPoll, showingCachedStanding, reloadStanding]);
  // A saved answer moves through My votes with Previous and Next (#528).
  // Any other question keeps the answer-selected Next (#502), and while a
  // saved answer's neighbours are still being read there is no Next at all.
  const myVotesNavigation: MyVotesNavigation | undefined =
    myVotesPlace.kind === "found"
      ? {
          previous: opener(myVotesPlace.previous, onGo),
          next: opener(myVotesPlace.next, onGo),
        }
      : undefined;
  const answerNext =
    myVotesPlace.kind === "none" && showing.kind === "answered"
      ? nextFor(poll, ballot)
      : null;
  // What a left swipe opens on a phone (#554): only over the results, or a
  // closed question, so a change being made or sent is never dropped.
  const next =
    showing.kind === "answered" || (shut && myVotesNavigation)
      ? myVotesPlace.kind === "found"
        ? (myVotesPlace.next?.pollId ?? null)
        : answerNext
      : null;
  // Desktop only: the choices are open again over a saved answer.
  const changing = wide && !shut && !resultView && Boolean(saved);
  // Close is not offered while a change is being sent: the outcome decides
  // what shows, and focus follows it to the "You picked" line. While the
  // server is asked which answer it holds (#527), Close stays, marked as
  // unavailable, so focus does not fall to the page.
  const [checking, setChecking] = useState(false);
  // The failed send whose read-back also got no answer: the card says the
  // connection is still down rather than the send's own message.
  const [stillDown, setStillDown] = useState<CastState | null>(null);
  const closable = changing && status.kind !== "sending";
  // Read by a server reply that arrives after a later render.
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  });
  function finishRemoval(results?: Results): VoteUpdate {
    setRemoval({ status: "idle" });
    setRemoved(true);
    setShowSaved(false);
    setPicked([]);
    fresh.clear();
    reset();
    if (results) closed.showResults(results);
    else closed.close();
    return { status: "removed" };
  }
  async function removeVote(owner: string): Promise<VoteUpdate> {
    const sessionNow = await recheck(true);
    if (!sessionNow.settled) {
      setRemoval({
        status: "failed",
        message: "We couldn't check your account. Try again.",
      });
      return { status: "idle" };
    }
    if (sessionNow.accountId !== owner) {
      onAccountChanged(poll.id);
      return { status: "idle" };
    }
    try {
      const outcome = await api.removeVote(poll.id);
      if (outcome.status !== "closed") return finishRemoval(outcome.results);
      setRemoval({ status: "idle" });
      setRemovalClosed(true);
      closed.open();
      return { status: "closed" };
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status === 200
      ) {
        try {
          if ((await api.myBallot(poll.id)) === null) {
            const checked = await recheck(true);
            if (checked.settled && checked.accountId !== owner) {
              onAccountChanged(poll.id);
              return { status: "idle" };
            }
            if (checked.settled) {
              const results = await api.results(poll.id).catch(() => undefined);
              return finishRemoval(results);
            }
          }
        } catch {
          // The original error still applies when the ballot cannot be read.
        }
      }
      setRemoval({
        status: "failed",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't remove your vote. Try again.",
      });
      return { status: "idle" };
    }
  }
  function remove() {
    if (accountId === null || removal.status === "sending") return;
    setRemoval({ status: "sending" });
    onSent(poll, removeVote(accountId));
  }
  function change() {
    if (removal.status === "sending") return;
    setShowSaved(false);
    fresh.clear();
    reset();
    setCollapsed(false);
    setVisible(true);
  }
  // Back to an answer the server holds, with "Change my answer" focused.
  function backTo(answer: Answer) {
    reset();
    setPicked(answer.ballot);
    setShowSaved(true);
    if (wide) backedOut.current = true;
  }
  function close() {
    if (checking) return;
    if (saved && state.status === "failed" && !state.refused) {
      // After a lost connection, a cut-off reply or a 5xx the new answer may
      // have been stored, on a phone as on desktop: ask which one the server
      // holds and show that. If it cannot say, the card stays open, says the
      // connection is still down, and Close asks again. Try again waits
      // during the check, so a read that never finishes is given up on after
      // the same wait as a restore.
      const failed = state;
      setChecking(true);
      // Given up on after the wait, the read changes nothing when it ends.
      const wait = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        onReadBack(poll, wait.signal),
        new Promise<undefined>((done) => {
          timer = setTimeout(() => {
            wait.abort();
            done(undefined);
          }, RESTORE_WAIT_MS);
        }),
      ]).then((found) => {
        clearTimeout(timer);
        setChecking(false);
        if (current.current !== failed) return;
        if (found) {
          backTo(found);
          if (!wide) setVisible(false);
          return;
        }
        setStillDown(failed);
        wrapper.current
          ?.querySelector<HTMLElement>(".vote-card__dismiss, .vote-card__close")
          ?.focus();
      });
      return;
    }
    // Backing out of a change: the earlier answer still stands on the server,
    // so show it again rather than an empty ballot under "You picked".
    if (
      saved &&
      (status.kind === "answerable" ||
        (state.status === "failed" && state.refused))
    )
      backTo(saved);
    // On desktop the choices stay on the page: Close only backs out of a change.
    if (!wide) setVisible(false);
  }
  const handle = (
    <div className="conversation__help">
      <button
        type="button"
        ref={show}
        disabled={removal.status === "sending"}
        {...(showing.kind === "answered"
          ? { className: "conversation__handle--quiet" }
          : {})}
        onClick={() => {
          if (showing.kind === "answered") change();
          else setVisible(true);
        }}
      >
        {shut
          ? "Show question"
          : showing.kind === "answered"
            ? "Change my answer"
            : "Vote"}
      </button>
    </div>
  );
  const signInHref = pathOf({
    kind: "signIn",
    returnTo: { kind: "conversation", pollId: poll.id },
  });
  const privacyNote = publicPoll ? (
    shut ? null : (
      <>
        <strong>{votePrivacyNote("public")}</strong> Your answer is shown with
        your profile name or as “Verified voter”.
      </>
    )
  ) : (
    votePrivacyNote("anonymous")
  );
  const showStandaloneResults = shut || (publicPoll && !saved && !resultView);
  const listResults = showStandaloneResults
    ? closed.showing && closed.data.status === "ready"
      ? closed.data.value.results
      : undefined
    : showing.kind === "answered"
      ? showing.results
      : changing
        ? saved?.results
        : undefined;
  const publicVotes = usePublicVotes(api, listResults);
  const voteList =
    listResults?.votePrivacy === "public" && listResults.voters > 0 ? (
      <PublicVotes choices={listResults.choices} {...publicVotes} />
    ) : null;
  const removeAction =
    publicPoll && resultView && confirmation === "confirmed" ? (
      <TwoPress
        label="Remove my vote"
        question="Remove your answer and name from the results? You can vote again while the poll is open."
        confirmLabel="Remove vote"
        pendingLabel="Removing vote…"
        progress={removal}
        onConfirm={remove}
        onCancel={() => setRemoval({ status: "idle" })}
      />
    ) : null;
  const voteUnavailable = publicPoll && accountId === null;
  const needsSignIn = publicPoll && !shut && session.status === "signedOut";
  const sessionUnknown = publicPoll && !shut && session.status === "unknown";
  const card = (
    <div ref={wrapper}>
      <VoteCard
        presentation={showing.kind === "answered" ? "results" : "card"}
        inPage={wide}
        closable={closable}
        checking={checking}
        {...(wide && removal.status !== "sending" && !voteUnavailable
          ? { onChangeAnswer: change }
          : {})}
        question={poll.question}
        method={poll.method}
        choices={poll.choices.map((label, index) => ({ index, label }))}
        picked={picked}
        status={
          stillDown === state && showing.kind === "failed"
            ? { kind: "failed", message: UNREACHABLE }
            : showing
        }
        privacyNote={privacyNote}
        votingUnavailable={voteUnavailable}
        removed={removed && state.status === "idle"}
        {...(needsSignIn ? { signInToVoteHref: signInHref } : {})}
        {...(sessionUnknown
          ? { onRetrySession: () => void recheck(true) }
          : {})}
        publicVotes={voteList}
        answerActions={removeAction}
        trustHref={pathOf({ kind: "trust" })}
        confirmation={cardConfirmation}
        {...(!publicPoll ? { confirmHref: signInHref } : {})}
        {...(fresh.problem
          ? {
              resultsProblem: {
                message: fresh.problem,
                onRetry: fresh.refresh,
              },
            }
          : {})}
        collapsed={collapsed}
        onPick={setPicked}
        onSubmit={(ballot) => {
          setRemoved(false);
          onSent(poll, cast(ballot));
        }}
        onCollapse={setCollapsed}
        onClose={close}
        resultsHidden={resultsHidden}
        onResultsHidden={setResultsHidden}
        {...(myVotesNavigation
          ? { myVotesNavigation }
          : answerNext
            ? { onNext: () => onGo(answerNext) }
            : {})}
      />
    </div>
  );
  // While an answer is being changed on desktop, the saved one and its
  // results stay under the choices until the new one is counted (#490).
  const kept =
    changing && saved ? (
      <VoteCard
        presentation="results"
        inPage
        question={poll.question}
        method={poll.method}
        choices={poll.choices.map((label, index) => ({ index, label }))}
        picked={saved.ballot}
        status={{ kind: "answered", results: saved.results, changed: false }}
        privacyNote={privacyNote}
        publicVotes={voteList}
        trustHref={pathOf({ kind: "trust" })}
        confirmation={cardConfirmation}
        {...(!publicPoll ? { confirmHref: signInHref } : {})}
        collapsed={false}
        onPick={() => {}}
        onSubmit={() => {}}
        onCollapse={() => {}}
        onClose={() => {}}
        resultsHidden={resultsHidden}
        onResultsHidden={setResultsHidden}
      />
    ) : null;
  const pager = myVotesNavigation ? (
    <QuestionPager navigation={myVotesNavigation} />
  ) : null;
  // Offer results before voting on public polls. On closed questions, keep
  // Previous and Next beside See results or under the open panel (#528).
  const standing = showStandaloneResults ? (
    closed.showing ? (
      <>
        <ClosedResults
          data={closed.data}
          compact
          ended={shut}
          publicVotes={voteList}
          onRetry={closed.retry}
          onClose={closed.close}
          panelRef={closed.panelRef}
          explainHref={pathOf({ kind: "trust" })}
        />
        {shut && publicPoll && closed.data.status !== "ready" ? (
          <p>{votePrivacyNote("public", true)}</p>
        ) : null}
        {shut && pager ? (
          <div className="conversation__pager">{pager}</div>
        ) : null}
      </>
    ) : (
      <div className="conversation__closed">
        <button type="button" ref={closed.triggerRef} onClick={closed.open}>
          See results
        </button>
        {shut && publicPoll ? <p>{votePrivacyNote("public", true)}</p> : null}
        {shut ? pager : null}
      </div>
    )
  ) : showing.kind === "answered" ? (
    card
  ) : wide ? (
    kept
  ) : null;
  const vote = wide
    ? showing.kind === "answered"
      ? null
      : card
    : !visible || showing.kind === "answered"
      ? handle
      : card;
  // On a phone or tablet, a left swipe over an answered question does what
  // "Next question" does (#554); the button stays for everyone else.
  const swipeable = next !== null;
  const swipe = useSwipeLeft(swipeable ? () => onGo(next) : undefined);
  return (
    <div className="conversation__question" {...swipe}>
      {renderPage(standing, vote, shut)}
    </div>
  );
}
