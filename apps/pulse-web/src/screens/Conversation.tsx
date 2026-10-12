import { useCallback, useEffect, useRef, useState } from "react";
import type { Poll, PulseApi, Results } from "../api/types.js";
import { cardStatus, closingNote, nextFor } from "../flow/conversation.js";
import { pathOf } from "../flow/route.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import { useClosedResults } from "../hooks/use-closed-results.js";
import { VoteCard } from "../components/VoteCard.js";
import { ClosedResults } from "../components/ClosedResults.js";
import { ViewState } from "../components/ViewState.js";
import { TopBanner } from "../components/TopBanner.js";
import "./Conversation.css";

type Answer = { poll: Poll; ballot: number[]; results: Results };

/** A whole run stays in one conversation; only its active card changes. */
export function Conversation({
  api,
  pollId,
}: {
  api: PulseApi;
  pollId: string;
}) {
  const [at, setAt] = useState(pollId);
  const [answers, setAnswers] = useState<Answer[]>([]);
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
  const saved = answers.find((one) => one.poll.id === at);
  return (
    <div className="conversation">
      <header className="conversation__banner">
        <TopBanner signInHref={pathOf({ kind: "signIn" })} />
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
          key={at}
          api={api}
          pollId={at}
          answers={answers}
          {...(saved ? { saved } : {})}
          busy={busy}
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
  onCounted,
  onBusy,
  onGo,
}: {
  api: PulseApi;
  pollId: string;
  answers: readonly Answer[];
  saved?: Answer;
  busy: boolean;
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
  onCounted,
  onBusy,
  onGo,
}: {
  api: PulseApi;
  poll: Poll;
  saved?: Answer;
  onCounted: (answer: Answer) => void;
  onBusy: (busy: boolean) => void;
  onGo: (id: string) => void;
}) {
  const { state, cast, reset } = useCastVote(api, poll.id);
  const [picked, setPicked] = useState<number[]>(saved?.ballot ?? []);
  const [showSaved, setShowSaved] = useState(Boolean(saved));
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(false);
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
  const showing =
    status.kind === "answerable" && showSaved && saved
      ? { kind: "answered" as const, results: saved.results, changed: false }
      : status;
  const ballot = state.status === "counted" ? state.ballot : picked;
  const next = showing.kind === "answered" ? nextFor(poll, ballot) : null;
  const shut = status.kind === "closed";
  function change() {
    setShowSaved(false);
    reset();
    setCollapsed(false);
  }
  function close() {
    setVisible(false);
  }
  if (!visible)
    return (
      <button type="button" ref={show} onClick={() => setVisible(true)}>
        Vote
      </button>
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
        />
      </div>
    );
  return (
    <div ref={wrapper}>
      <VoteCard
        question={poll.question}
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
      {shut ? (
        <button type="button" ref={closed.triggerRef} onClick={closed.open}>
          See results
        </button>
      ) : null}
    </div>
  );
}
