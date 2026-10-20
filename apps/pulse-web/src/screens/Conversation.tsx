import { useCallback, useEffect, useRef, useState } from "react";
import type { Poll, PulseApi, Results } from "../api/types.js";
import { cardStatus, closingNote, nextFor } from "../flow/conversation.js";
import { byline } from "../flow/new-poll.js";
import { guideFor } from "../flow/vote-help.js";
import { pathOf } from "../flow/route.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import { useClosedResults } from "../hooks/use-closed-results.js";
import { ControlGuide } from "../components/ControlGuide.js";
import { useFreshResults } from "../hooks/use-fresh-results.js";
import type { Confirmation } from "../flow/vote-card.js";
import { VoteCard } from "../components/VoteCard.js";
import { ClosedResults } from "../components/ClosedResults.js";
import { ViewState } from "../components/ViewState.js";
import { TopBanner } from "../components/TopBanner.js";
import { SignedIn } from "../components/SignedIn.js";
import { ForgetVotes } from "../components/ForgetVotes.js";
import { useSession } from "../hooks/use-session.js";
import type { Session, SignOutProgress } from "../hooks/use-session.js";
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
}: {
  api: PulseApi;
  pollId: string;
  /** Runs once the server has signed this person out everywhere. */
  onSignedOut?: () => void;
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
  return (
    <div className="conversation">
      <header className="conversation__banner">
        <Banner
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
      <main className="conversation__main">
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

/**
 * The bar across the top, for whoever is (or is not) signed in.
 *
 * Nothing on the right while asking: a "Sign in" link that turns into an
 * address a moment later is the flicker this avoids. When the answer is
 * unknown, the way in is offered, because signing in again is harmless.
 */
function Banner({
  session,
  progress,
  holdsVotes,
  onSignOut,
  onCancel,
}: {
  session: Session;
  progress: SignOutProgress;
  /** Whether this browser holds votes someone could forget. */
  holdsVotes: boolean;
  onSignOut: () => void;
  onCancel: () => void;
}) {
  switch (session.status) {
    case "loading":
      return <TopBanner />;
    case "signedIn":
      return (
        <TopBanner
          postHref={pathOf({ kind: "newPoll" })}
          identity={
            <SignedIn
              email={session.me.email}
              progress={progress}
              onSignOut={onSignOut}
              onCancel={onCancel}
            />
          }
        />
      );
    case "signedOut":
    case "unknown":
      return (
        <TopBanner
          postHref={pathOf({ kind: "newPoll" })}
          signInHref={pathOf({ kind: "signIn" })}
          {...(holdsVotes
            ? {
                aside: (
                  <ForgetVotes
                    progress={progress}
                    onForget={onSignOut}
                    onCancel={onCancel}
                  />
                ),
              }
            : {})}
        />
      );
  }
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
  useEffect(() => {
    if (loaded.status === "ready") heading.current?.focus();
  }, [loaded.status]);
  return (
    <>
      <div className="conversation__scroll">
        <div className="conversation__column">
          <ViewState data={loaded}>
            {(poll) => (
              <section className="conversation__hero">
                <p>{closingNote(poll)}</p>
                <h1 ref={heading} tabIndex={-1}>
                  {poll.question}
                </h1>
                {byline(poll.attribution) ? (
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
            {answers.map((answer) => (
              <li key={answer.poll.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onGo(answer.poll.id)}
                >
                  {answer.poll.question}
                </button>
                <p>
                  You picked{" "}
                  {answer.ballot
                    .map((index) => answer.poll.choices[index])
                    .join(" and ")}
                  .
                </p>
                <small>Only you can see your answer here.</small>
              </li>
            ))}
          </ol>
          {answers.length === 0 && loaded.status === "ready" ? (
            <p className="conversation__empty">
              Your answers will appear here. Open the vote card to start.
            </p>
          ) : null}
        </div>
      </div>
      <div className="conversation__dock">
        <div className="conversation__column">
          {loaded.status === "ready" ? (
            <div className="conversation__vote">
              <LiveCard
                key={loaded.value.id}
                api={api}
                poll={loaded.value}
                {...(saved ? { saved } : {})}
                confirmation={confirmation}
                onCounted={onCounted}
                onBusy={onBusy}
                onGo={onGo}
              />
            </div>
          ) : null}
          <label className="conversation__composer">
            Message
            <textarea
              disabled
              placeholder="The assistant is not available yet."
              aria-describedby="conversation-assistant-note"
            />
          </label>
          <p id="conversation-assistant-note" className="conversation__note">
            The assistant is not available yet. Use the vote card to answer.
          </p>
        </div>
      </div>
    </>
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
}: {
  api: PulseApi;
  poll: Poll;
  saved?: Answer;
  confirmation: Confirmation;
  onCounted: (answer: Answer) => void;
  onBusy: (busy: boolean) => void;
  onGo: (id: string) => void;
}) {
  const { state, cast, reset } = useCastVote(api, poll.id);
  const [picked, setPicked] = useState<number[]>(saved?.ballot ?? []);
  const [showSaved, setShowSaved] = useState(Boolean(saved));
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [helping, setHelping] = useState(false);
  const help = useRef<HTMLButtonElement>(null);
  const guideRoot = useRef<HTMLDivElement>(null);
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
  const next = showing.kind === "answered" ? nextFor(poll, ballot) : null;
  const shut = status.kind === "closed";
  function change() {
    setShowSaved(false);
    fresh.clear();
    reset();
    setCollapsed(false);
  }
  function close() {
    setVisible(false);
  }
  const guide = guideFor(
    visible,
    collapsed,
    showing.kind,
    picked.length > 0,
    Boolean(next),
  );
  const dismissHelp = () => {
    setHelping(false);
    help.current?.focus();
  };
  const helpButton = poll.open ? (
    <button
      type="button"
      ref={help}
      onClick={() => {
        setHelping(true);
      }}
    >
      Show me how
    </button>
  ) : null;
  const coach = helping ? (
    <ControlGuide
      root={guideRoot}
      selector={guide.selector}
      text={guide.text}
      finished={guide.finished}
      onDismiss={dismissHelp}
    />
  ) : null;
  if (!visible)
    return (
      <div ref={guideRoot} className="conversation__help">
        <button
          type="button"
          data-guide="open"
          ref={show}
          onClick={() => setVisible(true)}
        >
          Vote
        </button>
        {helpButton}
        {coach}
      </div>
    );
  if (shut && closed.showing)
    return (
      <div className="vote-card">
        <ClosedResults
          data={closed.data}
          onRetry={closed.retry}
          onClose={() => {
            closed.close();
            close();
          }}
          panelRef={closed.panelRef}
          explainHref={pathOf({ kind: "trust" })}
        />
      </div>
    );
  return (
    <div ref={guideRoot}>
      {helpButton}
      {coach}
      <div ref={wrapper}>
        <VoteCard
          question={poll.question}
          {...(byline(poll.attribution)
            ? { byline: byline(poll.attribution) as string }
            : {})}
          why={closingNote({ ...poll, open: !shut })}
          method={poll.method}
          choices={poll.choices.map((label, index) => ({
            index,
            label,
            ...(poll.next[index] ? { detail: "Opens another question" } : {}),
          }))}
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
      {shut ? (
        <button type="button" ref={closed.triggerRef} onClick={closed.open}>
          See results
        </button>
      ) : null}
    </div>
  );
}
