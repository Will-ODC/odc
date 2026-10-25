import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Poll, PulseApi, Results } from "../api/types.js";
import { cardStatus, closingNote, nextFor } from "../flow/conversation.js";
import { byline } from "../flow/new-poll.js";
import { pathOf } from "../flow/route.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import { useClosedResults } from "../hooks/use-closed-results.js";
import { useFreshResults } from "../hooks/use-fresh-results.js";
import type { Confirmation } from "../flow/vote-card.js";
import { VoteCard } from "../components/VoteCard.js";
import { ClosedResults } from "../components/ClosedResults.js";
import { ViewState } from "../components/ViewState.js";
import { PostedBanner } from "../components/PostedBanner.js";
import { useSession } from "../hooks/use-session.js";
import type { Session } from "../hooks/use-session.js";
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

/** Whether a poll's closing time has passed, by this browser's clock. */
function hasClosed(poll: Poll): boolean {
  return poll.closesAt !== null && Date.parse(poll.closesAt) <= Date.now();
}

/** A whole run stays in one conversation; only its active card changes. */
export function Conversation({
  api,
  pollId,
  onSignedOut,
  posted,
}: {
  api: PulseApi;
  pollId: string;
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
  // Whether this browser held a ballot before this visit. The ballot cookie
  // cannot be read from script, so the first question's ballot stands in.
  const [heldBefore, setHeldBefore] = useState(false);
  // Bumped when the votes are forgotten, so the question starts over.
  const [round, setRound] = useState(0);
  const forgotten = useCallback(() => {
    setAnswers([]);
    setHeldBefore(false);
    setAt(pollId);
    setRound((n) => n + 1);
  }, [pollId]);
  const { session, progress, signOut, dismiss } = useSession(api, {
    ...(onSignedOut ? { onSignedOut } : {}),
    onForgotten: forgotten,
  });
  useEffect(() => {
    let live = true;
    api.myBallot(pollId).then(
      (ballot) => {
        if (live) setHeldBefore(ballot !== null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, pollId]);
  const [busy, setBusy] = useState(false);
  const counted = useCallback((answer: Answer) => {
    setAnswers((old) =>
      old.some((one) => one.poll.id === answer.poll.id)
        ? old.map((one) => (one.poll.id === answer.poll.id ? answer : one))
        : [...old, answer],
    );
  }, []);
  const go = (id: string) => {
    if (!busy) setAt(id);
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
  const saved = answers.find((one) => one.poll.id === at);
  const main = useRef<HTMLElement>(null);
  // "Your question is live" belongs to the question just posted. "Next"
  // moves to another without a route change, so leaving it ends the line.
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
          holdsVotes={heldBefore || answers.length > 0}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
      <aside className="conversation__sidebar">
        <nav aria-label="Answered">
          <h2>Answered</h2>
          {answers.length === 0 ? <p>No answers yet.</p> : null}
          {answers.map((answer) => (
            <button
              key={answer.poll.id}
              type="button"
              disabled={busy}
              aria-current={at === answer.poll.id ? "step" : undefined}
              onClick={() => go(answer.poll.id)}
            >
              {answer.poll.question}
            </button>
          ))}
        </nav>
        <p>More questions will appear here as you answer.</p>
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
          key={`${round}:${at}`}
          api={api}
          pollId={at}
          answers={answers}
          {...(saved ? { saved } : {})}
          busy={busy}
          confirmation={confirmation}
          onCounted={counted}
          onBusy={setBusy}
          onGo={go}
        />
      </main>
    </div>
  );
}
function Question({
  api,
  pollId,
  answers,
  saved,
  busy,
  confirmation,
  onCounted,
  onBusy,
  onGo,
}: {
  api: PulseApi;
  pollId: string;
  answers: readonly Answer[];
  saved?: Answer;
  busy: boolean;
  confirmation: Confirmation;
  onCounted: (answer: Answer) => void;
  onBusy: (busy: boolean) => void;
  onGo: (id: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  // Retrying remounts the loader so usePoll's request cleanup discards stale results.
  return (
    <LoadedQuestion
      key={attempt}
      api={api}
      pollId={pollId}
      answers={answers}
      {...(saved ? { saved } : {})}
      busy={busy}
      confirmation={confirmation}
      onCounted={onCounted}
      onBusy={onBusy}
      onGo={onGo}
      onRetry={() => setAttempt((one) => one + 1)}
    />
  );
}

function LoadedQuestion({
  api,
  pollId,
  answers,
  saved,
  busy,
  confirmation,
  onCounted,
  onBusy,
  onGo,
  onRetry,
}: {
  api: PulseApi;
  pollId: string;
  answers: readonly Answer[];
  saved?: Answer;
  busy: boolean;
  confirmation: Confirmation;
  onCounted: (answer: Answer) => void;
  onBusy: (busy: boolean) => void;
  onGo: (id: string) => void;
  onRetry: () => void;
}) {
  const loaded = usePoll(api, pollId);
  const heading = useRef<HTMLHeadingElement>(null);
  /*
   * Whether the vote card is open and showing the question. Then the card
   * says the question and closing date, and the page heading is kept for
   * screen readers and focus but not drawn a second time (operator
   * walkthrough, 2026-10-21; see `.conversation__hero--merged`).
   */
  const [cardOpen, setCardOpen] = useState(true);
  useEffect(() => {
    if (loaded.status === "ready") heading.current?.focus();
  }, [loaded.status]);
  const renderPage = (
    standing: ReactNode,
    vote: ReactNode,
    current?: Answer,
  ) => {
    // Render the saved answer and its results in the same commit, before the
    // conversation history catches up, so the focused panel never changes rows.
    const thread =
      current && !answers.some((answer) => answer.poll.id === current.poll.id)
        ? [...answers, current]
        : answers;
    return (
      <>
        <div className="conversation__scroll">
          <div className="conversation__column">
            <ViewState data={loaded}>
              {(poll) => (
                // One heading node while the card opens and closes, so focus
                // on it survives; it is drawn afresh once the poll loads.
                <section
                  className={
                    cardOpen
                      ? "conversation__hero conversation__hero--merged"
                      : "conversation__hero"
                  }
                >
                  {cardOpen ? null : <p>{closingNote(poll)}</p>}
                  <h1 ref={heading} tabIndex={-1}>
                    {poll.question}
                  </h1>
                  {!cardOpen && byline(poll.attribution) ? (
                    <p className="conversation__byline">
                      {byline(poll.attribution)}
                    </p>
                  ) : null}
                </section>
              )}
            </ViewState>
            {loaded.status === "error" || loaded.status === "empty" ? (
              <button type="button" onClick={onRetry}>
                Try again
              </button>
            ) : null}
            <ol className="conversation__thread" aria-label="Conversation">
              {thread.map((answer) => (
                <li key={answer.poll.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onGo(answer.poll.id)}
                  >
                    {answer.poll.question}
                  </button>
                  <p className="conversation__answer">
                    You picked{" "}
                    {answer.ballot
                      .map((index) => answer.poll.choices[index])
                      .join(" and ")}
                    .
                  </p>
                  {answer.poll.id === pollId ? standing : null}
                </li>
              ))}
            </ol>
            {!thread.some((answer) => answer.poll.id === pollId)
              ? standing
              : null}
            {thread.length === 0 && loaded.status === "ready" ? (
              <p className="conversation__empty">
                Your answers will appear here after you submit.
              </p>
            ) : null}
          </div>
        </div>
        {vote ? (
          <aside className="conversation__dock" aria-label="Voting">
            <div className="conversation__column">
              <div className="conversation__vote">{vote}</div>
            </div>
          </aside>
        ) : null}
      </>
    );
  };
  return loaded.status === "ready" ? (
    <LiveCard
      key={loaded.value.id}
      api={api}
      poll={loaded.value}
      {...(saved ? { saved } : {})}
      confirmation={confirmation}
      onCounted={onCounted}
      onBusy={onBusy}
      onGo={onGo}
      onCardOpen={setCardOpen}
      renderPage={renderPage}
    />
  ) : (
    renderPage(null, null)
  );
}

function LiveCard({
  api,
  poll,
  saved,
  confirmation,
  onCounted,
  onBusy,
  onGo,
  onCardOpen,
  renderPage,
}: {
  api: PulseApi;
  poll: Poll;
  saved?: Answer;
  confirmation: Confirmation;
  onCounted: (answer: Answer) => void;
  onBusy: (busy: boolean) => void;
  onGo: (id: string) => void;
  /** Whether the open card is showing the question, for the page heading. */
  onCardOpen: (open: boolean) => void;
  renderPage: (
    standing: ReactNode,
    vote: ReactNode,
    current?: Answer,
  ) => ReactNode;
}) {
  const { state, cast, reset } = useCastVote(api, poll.id);
  const [picked, setPicked] = useState<number[]>(saved?.ballot ?? []);
  const [showSaved, setShowSaved] = useState(Boolean(saved));
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const show = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(true);
  const closed = useClosedResults(api, poll.id);
  const previous = useRef(state);
  useEffect(() => {
    onBusy(state.status === "casting");
    if (state.status === "counted" && state !== previous.current) {
      setPicked(state.ballot);
      onCounted({ poll, ballot: state.ballot, results: state.results });
    }
    previous.current = state;
  }, [state, poll, onCounted, onBusy]);
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
    onCounted({ poll, ballot, results }),
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
  // The one place focus follows results in and out of the page. Backing out
  // of a change closes the drawer, and focus stays on its handle instead.
  useEffect(() => {
    if (
      visible &&
      ((resultView && document.activeElement === document.body) ||
        hadResults.current !== resultView)
    ) {
      const node = wrapper.current;
      const target = resultView
        ? node?.querySelector<HTMLElement>(".results")
        : (node?.querySelector<HTMLElement>("input:checked") ??
          node?.querySelector<HTMLElement>("input"));
      target?.focus();
    }
    hadResults.current = resultView;
  }, [resultView, saved, visible]);
  const next = showing.kind === "answered" ? nextFor(poll, ballot) : null;
  const shut = status.kind === "closed";
  // The card, open or folded, names the question; closed results do not.
  const showsQuestion =
    visible && showing.kind !== "answered" && !(shut && closed.showing);
  useEffect(() => onCardOpen(showsQuestion), [onCardOpen, showsQuestion]);
  function change() {
    setShowSaved(false);
    fresh.clear();
    reset();
    setCollapsed(false);
    setVisible(true);
  }
  function close() {
    // Backing out of a change: the earlier answer still stands on the server,
    // so show it again rather than an empty ballot under "You picked". Not
    // after a lost connection, when the new answer may have been stored.
    if (
      saved &&
      (status.kind === "answerable" ||
        (state.status === "failed" && state.refused))
    ) {
      reset();
      setPicked(saved.ballot);
      setShowSaved(true);
    }
    setVisible(false);
  }
  const handle = (
    <div className="conversation__help">
      <button
        type="button"
        ref={show}
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
        question={poll.question}
        {...(byline(poll.attribution)
          ? { byline: byline(poll.attribution) as string }
          : {})}
        why={closingNote({ ...poll, open: !shut })}
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
        onSubmit={(ballot) => {
          onBusy(true);
          cast(ballot);
        }}
        onCollapse={setCollapsed}
        onClose={close}
        {...(showing.kind === "answered" && poll.open
          ? { onChangeAnswer: change }
          : {})}
        {...(next ? { onNext: () => onGo(next) } : {})}
      />
    </div>
  );
  const standing = shut ? (
    closed.showing ? (
      <ClosedResults
        data={closed.data}
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
  ) : null;
  const vote = !visible || showing.kind === "answered" ? handle : card;
  return (
    <div className="conversation__question">
      {renderPage(
        standing,
        vote,
        showing.kind === "answered"
          ? { poll, ballot, results: showing.results }
          : undefined,
      )}
    </div>
  );
}
