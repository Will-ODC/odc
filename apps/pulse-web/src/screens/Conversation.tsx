import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Ballot, Poll, PulseApi, Results } from "../api/types.js";
import type { Route } from "../flow/route.js";
import { cardStatus, closingNote, nextFor } from "../flow/conversation.js";
import { byline } from "../flow/new-poll.js";
import { pathOf } from "../flow/route.js";
import { answeredList } from "../flow/answered.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import type { CastState } from "../hooks/use-cast-vote.js";
import { useClosedResults } from "../hooks/use-closed-results.js";
import { useFreshResults } from "../hooks/use-fresh-results.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useWide } from "../hooks/use-wide.js";
import type { Confirmation } from "../flow/vote-card.js";
import { VoteCard } from "../components/VoteCard.js";
import { ClosedResults } from "../components/ClosedResults.js";
import { ViewState } from "../components/ViewState.js";
import { AnsweredList } from "../components/AnsweredList.js";
import { PostedBanner } from "../components/PostedBanner.js";
import { CopyLink } from "../components/CopyLink.js";
import { useSession } from "../hooks/use-session.js";
import type { Session } from "../hooks/use-session.js";
import type { ViewData } from "../hooks/view-data.js";
import { SiteBanner } from "./SiteBanner.js";
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
type Sent = (poll: Poll, outcome: Promise<CastState>) => void;

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

/** Rail copy when the saved answers cannot be read (#488). */
const RAIL_ERROR = "We couldn't load your votes.";
const RAIL_PARTIAL_ERROR = "We couldn't load all your votes.";
const RAIL_RELOADED = "Your votes are loaded.";
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
  onSignedOut?: () => void;
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
  const { clear: clearMine } = mine;
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
  // Signing out clears the ballot cookie (API.md), and the list with it.
  const signedOut = useCallback(() => {
    setRailRetried(false);
    clearMine();
    onSignedOut?.();
  }, [clearMine, onSignedOut]);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: signedOut,
    onForgotten: forgotten,
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
  // Undefined when the server could not say, the votes were forgotten, or
  // the question was sent again while it was asked.
  const readBack = useCallback(
    async (poll: Poll): Promise<Answer | undefined> => {
      const askedAt = stamp(poll.id);
      const found = await savedAnswer(api, poll);
      if (!found || stamp(poll.id) !== askedAt) return undefined;
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
    (poll: Poll, outcome: Promise<CastState>) => {
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
        else if (left && state.status === "failed" && !state.refused) {
          // The connection was lost: the answer may have been stored. Ask.
          await readBack(poll);
          if (!current()) return;
        }
        if (!left) return;
        setUnsettled((old) => old.filter((id) => id !== poll.id));
        if (latest.current.at === poll.id) setSettledAgain((n) => n + 1);
      });
    },
    [counted, readBack],
  );
  // Every question link, including Next, follows the rail's history path
  // (#502). Open locally too for callers without a router; do not push when
  // the address already names the question.
  const go = (id: string) => {
    if (busy || id === at) return;
    setAt(id);
    if (id !== pollId) onNavigate?.({ kind: "conversation", pollId: id });
  };
  const confirmation = confirmationOf(session);
  // Signing in confirms every vote already given here, so every result already
  // shown is missing it from the confirmed number.
  const before = useRef(confirmation);
  useEffect(() => {
    if (before.current !== "confirmed" && confirmation === "confirmed")
      setAnswers((old) => old.map((one) => ({ ...one, stale: true })));
    before.current = confirmation;
  }, [confirmation]);
  // What the question may claim: not an answer whose change is still out.
  const settledAnswers = answers.filter(
    (one) => !unsettled.includes(one.poll.id),
  );
  const saved = settledAnswers.find((one) => one.poll.id === at);
  const answered = answeredList(
    mine.data.status === "ready" ? mine.data.value.votes : [],
    answers,
    recentAnswers,
  );
  const railHeading = useRef<HTMLAnchorElement>(null);
  // One status region for the rail, mounted throughout, so each change is read
  // out: Loading… while the list is read (with answers already listed too),
  // then an error, the empty message, or nothing to show.
  const railState: ViewData<null> =
    mine.data.status === "error"
      ? {
          status: "error",
          message: answered.length > 0 ? RAIL_PARTIAL_ERROR : RAIL_ERROR,
        }
      : mine.data.status === "loading"
        ? { status: "loading" }
        : mine.data.status === "empty" && answered.length === 0
          ? { status: "empty", message: mine.data.message }
          : { status: "ready", value: null };
  const main = useRef<HTMLElement>(null);
  // "Your question is live" belongs to the question just posted. Leaving it
  // for another question ends the line.
  const leftPosted = posted !== undefined && at !== pollId;
  const dismissPosted = posted?.onDismiss;
  useEffect(() => {
    if (leftPosted) dismissPosted?.();
  }, [leftPosted, dismissPosted]);
  return (
    <div className="conversation">
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
      <aside className="conversation__sidebar">
        <nav aria-label="My votes">
          <h2>
            <a ref={railHeading} href={pathOf({ kind: "myVotes" })}>
              My votes
            </a>
          </h2>
          {answered.length > 0 ? (
            <AnsweredList
              votes={answered}
              current={at}
              compact
              disabled={busy}
              onOpen={go}
            />
          ) : null}
          <ViewState
            data={railState}
            variant="compact"
            persistent
            {...(railRetried ? { readyNote: RAIL_RELOADED } : {})}
          >
            {() => null}
          </ViewState>
          {mine.data.status === "error" ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                // The button goes while the list is read again; focus stays in
                // the rail rather than falling to the page.
                railHeading.current?.focus();
                setRailRetried(true);
                mine.retry();
              }}
            >
              Try again
            </button>
          ) : null}
          {mine.data.status === "ready" && mine.data.value.nextCursor ? (
            <p>
              <a href={pathOf({ kind: "myVotes" })}>See all my votes</a>
            </p>
          ) : null}
        </nav>
      </aside>
      <main className="conversation__main" ref={main}>
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
        <Question
          key={`${round}:${at}:${settledAgain}`}
          api={api}
          pollId={at}
          {...(saved ? { saved } : {})}
          waiting={unsettled.includes(at)}
          confirmation={confirmation}
          onRemembered={remembered}
          onReadBack={readBack}
          onHeldBallot={foundHeldBallot}
          onSent={sent}
          onGo={go}
          // The posting banner already offers Copy link; one is enough.
          shareable={!(posted && at === pollId)}
        />
      </main>
    </div>
  );
}
function Question({
  api,
  pollId,
  saved,
  waiting,
  confirmation,
  onRemembered,
  onReadBack,
  onHeldBallot,
  onSent,
  onGo,
  shareable,
}: {
  api: PulseApi;
  pollId: string;
  saved?: Answer;
  waiting: boolean;
  confirmation: Confirmation;
  onRemembered: (answer: Answer) => void;
  /** Asks the server which answer it holds for a poll, and lists it. */
  onReadBack: (poll: Poll) => Promise<Answer | undefined>;
  onHeldBallot: () => void;
  onSent: Sent;
  onGo: (id: string) => void;
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
      confirmation={confirmation}
      onRemembered={onRemembered}
      onReadBack={onReadBack}
      onHeldBallot={onHeldBallot}
      onSent={onSent}
      onGo={onGo}
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
  confirmation,
  onRemembered,
  onReadBack,
  onHeldBallot,
  onSent,
  onGo,
  shareable,
  onRetry,
}: {
  api: PulseApi;
  pollId: string;
  saved?: Answer;
  /** A send left behind for this question has not settled yet. */
  waiting: boolean;
  confirmation: Confirmation;
  onRemembered: (answer: Answer) => void;
  /** Asks the server which answer it holds for a poll, and lists it. */
  onReadBack: (poll: Poll) => Promise<Answer | undefined>;
  onHeldBallot: () => void;
  onSent: Sent;
  onGo: (id: string) => void;
  /** Whether to offer Copy link under the question. */
  shareable: boolean;
  onRetry: () => void;
}) {
  const fetched = usePoll(api, pollId);
  const restored = useRestoredAnswer(
    api,
    fetched.status === "ready" ? fetched.value : null,
    saved,
    waiting,
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
  const renderPage = (
    standing: ReactNode,
    vote: ReactNode,
    pollClosed = false,
  ) => {
    return (
      <>
        <div className="conversation__scroll">
          <div className="conversation__column">
            <ViewState data={loaded}>
              {(poll) => (
                // One heading node while the card opens and closes, so focus
                // on it survives; it is drawn afresh once the poll loads.
                <section className="conversation__hero">
                  <p>
                    {closingNote({ ...poll, open: poll.open && !pollClosed })}
                  </p>
                  <h1 ref={heading} tabIndex={-1}>
                    {poll.question}
                  </h1>
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
              )}
            </ViewState>
            {loaded.status === "error" || loaded.status === "empty" ? (
              <button type="button" onClick={onRetry}>
                Try again
              </button>
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
          <aside className="conversation__dock" aria-label="Voting">
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
      key={loaded.value.id}
      api={api}
      poll={loaded.value}
      {...(saved ? { saved } : {})}
      confirmation={confirmation}
      onRemembered={onRemembered}
      onReadBack={onReadBack}
      onSent={onSent}
      onGo={onGo}
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
  onHeldBallot: () => void,
  onFound: (answer: Answer) => void,
): "pending" | "settled" | "stillSending" {
  const [settled, setSettled] = useState(Boolean(saved));
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
      setSettled(true);
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
  }, [api, poll, settled, waiting, onHeldBallot]);
  return settled ? "settled" : slow ? "stillSending" : "pending";
}

function LiveCard({
  api,
  poll,
  saved,
  confirmation,
  onRemembered,
  onReadBack,
  onSent,
  onGo,
  wide,
  renderPage,
}: {
  api: PulseApi;
  poll: Poll;
  saved?: Answer;
  confirmation: Confirmation;
  onRemembered: (answer: Answer) => void;
  /** Asks the server which answer it holds for a poll, and lists it. */
  onReadBack: (poll: Poll) => Promise<Answer | undefined>;
  onSent: Sent;
  onGo: (id: string) => void;
  /** The desktop layout (#490): voting in the page, no drawer. */
  wide: boolean;
  renderPage: (
    standing: ReactNode,
    vote: ReactNode,
    pollClosed?: boolean,
  ) => ReactNode;
}) {
  const { state, cast, reset } = useCastVote(api, poll.id);
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
  const closed = useClosedResults(api, poll.id);
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
  const status = cardStatus(poll, state);
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
  const next = showing.kind === "answered" ? nextFor(poll, ballot) : null;
  const shut = status.kind === "closed";
  // Desktop only: the choices are open again over a saved answer.
  const changing = wide && !shut && !resultView && Boolean(saved);
  // Close is not offered while a change is being sent, nor while the server
  // is asked which answer it holds: the outcome decides what shows, and
  // focus follows it to the "You picked" line.
  const [checking, setChecking] = useState(false);
  const closable = changing && status.kind !== "sending" && !checking;
  // Read by a server reply that arrives after a later render.
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  });
  function change() {
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
    // Backing out of a change: the earlier answer still stands on the server,
    // so show it again rather than an empty ballot under "You picked".
    if (
      saved &&
      (status.kind === "answerable" ||
        (state.status === "failed" && state.refused))
    )
      backTo(saved);
    else if (wide && saved && state.status === "failed") {
      // After a lost connection the new answer may have been stored: ask
      // which one the server holds and show that. If it cannot say, the
      // card stays as it is, and Close asks again.
      const failed = state;
      setChecking(true);
      void onReadBack(poll).then((found) => {
        setChecking(false);
        if (found && current.current === failed) backTo(found);
      });
    }
    // On desktop the choices stay on the page: Close only backs out of a change.
    if (!wide) setVisible(false);
  }
  const handle = (
    <div className="conversation__help">
      <button
        type="button"
        ref={show}
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
  const card = (
    <div ref={wrapper}>
      <VoteCard
        presentation={showing.kind === "answered" ? "results" : "card"}
        inPage={wide}
        closable={closable}
        {...(wide ? { onChangeAnswer: change } : {})}
        question={poll.question}
        method={poll.method}
        choices={poll.choices.map((label, index) => ({ index, label }))}
        picked={picked}
        status={showing}
        privacyNote="Your answer is private."
        trustHref={pathOf({ kind: "trust" })}
        confirmation={cardConfirmation}
        confirmHref={pathOf({
          kind: "signIn",
          returnTo: { kind: "conversation", pollId: poll.id },
        })}
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
        onSubmit={(ballot) => onSent(poll, cast(ballot))}
        onCollapse={setCollapsed}
        onClose={close}
        resultsHidden={resultsHidden}
        onResultsHidden={setResultsHidden}
        {...(next ? { onNext: () => onGo(next) } : {})}
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
        privacyNote="Your answer is private."
        trustHref={pathOf({ kind: "trust" })}
        confirmation={cardConfirmation}
        confirmHref={pathOf({
          kind: "signIn",
          returnTo: { kind: "conversation", pollId: poll.id },
        })}
        collapsed={false}
        onPick={() => {}}
        onSubmit={() => {}}
        onCollapse={() => {}}
        onClose={() => {}}
        resultsHidden={resultsHidden}
        onResultsHidden={setResultsHidden}
      />
    ) : null;
  const standing = shut ? (
    closed.showing ? (
      <ClosedResults
        data={closed.data}
        compact
        onRetry={closed.retry}
        onClose={closed.close}
        panelRef={closed.panelRef}
        explainHref={pathOf({ kind: "trust" })}
      />
    ) : (
      <button type="button" ref={closed.triggerRef} onClick={closed.open}>
        See results
      </button>
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
  return (
    <div className="conversation__question">
      {renderPage(standing, vote, shut)}
    </div>
  );
}
