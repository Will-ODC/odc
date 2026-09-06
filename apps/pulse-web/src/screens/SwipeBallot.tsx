import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { Poll, PulseApi } from "../api/types.js";
import type { Lean, Side } from "../flow/swipe.js";
import {
  choiceFor,
  leanOf,
  releaseOf,
  sideOfChoice,
  sideOfKey,
} from "../flow/swipe.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import { edgesOf, useNextQuestions } from "../hooks/use-next-questions.js";
import { BallotChrome } from "../components/BallotChrome.js";
import { AfterVote } from "../components/AfterVote.js";
import { Refusal } from "../components/Refusal.js";
import "./SwipeBallot.css";

const AT_REST: Lean = { side: null, strength: 0 };

/** A press that travelled less than this is a tap that wobbled, not a drag. */
const DRAG_SLOP = 4;

export interface SwipeBallotProps {
  api: PulseApi;
  /** Always a two-choice, one-answer poll. `App` picks this screen for those. */
  poll: Poll;
  onAnswered: (next: string | null) => void;
  /** Absent on the first question of a run - see `BallotChrome`. */
  onBack?: (() => void) | undefined;
}

/**
 * The opening ballot: one question, two sides, answered by swiping.
 *
 * Each side previews the question it opens, because answering here is also
 * choosing where the run goes next.
 */
export function SwipeBallot({
  api,
  poll,
  onAnswered,
  onBack,
}: SwipeBallotProps) {
  const { state, cast, reset } = useCastVote(api, poll.id);
  const [lean, setLean] = useState<Lean>(AT_REST);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  /**
   * Set when a gesture has already decided this press, so the `click` the
   * browser fires afterwards does not decide it a second time.
   *
   * A tap on a half is `pointerdown → pointerup → click`. The pointer handlers
   * and the half's own `onClick` are two answers to one press, and without
   * this the vote is cast twice — the second cast comes back `changed`, so a
   * first-time voter is told their answer replaced an earlier one.
   */
  const gestureDecided = useRef(false);
  const nextQuestions = useNextQuestions(api, edgesOf(poll.next));
  /**
   * Set when the question was put back deliberately, so focus can be sent to a
   * side rather than dropped on the document body.
   *
   * Focus matters more here than it looks: the arrow keys that answer this
   * ballot are read by a handler on the `<section>`, so a keypress only reaches
   * it from a control inside. The control that was pressed to come back is
   * unmounted by the same render, and body-level keys do not bubble into the
   * section - someone who changed their answer by keyboard would find the
   * arrows dead.
   */
  const reAsked = useRef(false);
  const firstSide = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.status === "idle" && reAsked.current) {
      reAsked.current = false;
      firstSide.current?.focus();
    }
  }, [state.status]);

  const settled =
    state.status === "casting" ||
    state.status === "counted" ||
    state.status === "closed";
  const chosen =
    state.status === "casting" || state.status === "counted"
      ? (sideOfChoice(state.choice) ?? null)
      : null;

  function commit(side: Side) {
    setLean({ side, strength: 1 });
    cast(choiceFor(side));
  }

  /**
   * Put the question back. The lean goes with it - it is what tints the ballot
   * towards the side that won, and leaving it set would show the old answer
   * still winning a question nobody has answered yet.
   */
  function changeAnswer() {
    reAsked.current = true;
    /*
     * Back to the state a fresh mount would be in. A drag that commits answers
     * the press through `gestureDecided` and the `click` that consumes it never
     * arrives — settling unmounts the halves in the same flush — so the flag is
     * still set here. Advancing to the next question threw it away with the
     * whole screen (`key={poll.id}`); this is the one path that returns to a
     * live screen, so it is the one that has to clear it. Left set, it swallows
     * the first keyboard press on a half, which is exactly where the focus move
     * below sends someone.
     */
    gestureDecided.current = false;
    drag.current = null;
    setLean(AT_REST);
    reset();
  }

  /**
   * A half was pressed — by pointer, by Enter, or by Space.
   *
   * Two things stop this being a second vote. A gesture that already answered
   * the press says so through `gestureDecided`, and it is consumed here rather
   * than left set, so it can never swallow a later press. And once the ballot
   * has settled nothing casts, which is the same stop the keyboard path and
   * `onPointerDown` already have; this was the one entry point without it.
   */
  function pick(side: Side) {
    if (gestureDecided.current) {
      gestureDecided.current = false;
      return;
    }
    if (settled) return;
    commit(side);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (settled) return;
    gestureDecided.current = false;
    drag.current = { from: event.clientX, moved: false };
    // Not implemented in jsdom, and not required for the gesture to work.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held) return;
    const dx = event.clientX - held.from;
    if (Math.abs(dx) > DRAG_SLOP) held.moved = true;
    setLean(leanOf(dx));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held) return;
    drag.current = null;

    const dx = event.clientX - held.from;

    // Any press that travelled is a gesture, and this is where it is answered
    // — whether it committed or sprang back. The click that follows must not
    // answer it again.
    gestureDecided.current = held.moved;

    const released = releaseOf(dx);
    if (released) {
      gestureDecided.current = true;
      return commit(released);
    }

    // A press that never travelled is a tap. The tap is NOT handled here: each
    // half is a real button and its `onClick` casts it — see `Half`. Casting
    // here as well is what made one press two votes.
    setLean(AT_REST);
  }

  const style = {
    "--lean-left":
      chosen === "left" ? 1 : lean.side === "left" ? lean.strength : 0,
    "--lean-right":
      chosen === "right" ? 1 : lean.side === "right" ? lean.strength : 0,
  } as CSSProperties;

  return (
    <section
      className="ballot"
      style={style}
      {...(chosen ? { "data-won": chosen } : {})}
      onKeyDown={(event) => {
        const side = sideOfKey(event.key);
        if (side && !settled) {
          event.preventDefault();
          commit(side);
        }
      }}
    >
      <div className="ballot__tint" aria-hidden="true">
        <span className="ballot__tint-left" />
        <span className="ballot__tint-right" />
      </div>

      <div className="ballot__content">
        <BallotChrome poll={poll} {...(onBack ? { onBack } : {})} />
        {state.status === "failed" ? <Refusal message={state.message} /> : null}

        {settled ? (
          <div className="ballot__done">
            <AfterVote
              state={state}
              changeable={poll.open}
              onChange={changeAnswer}
              label={chosen ? (poll.choices[choiceFor(chosen)] ?? "") : ""}
              hasNext={chosen ? poll.next[choiceFor(chosen)] !== null : false}
              nextQuestion={
                chosen ? nextQuestions[choiceFor(chosen)] : undefined
              }
              onNext={() =>
                onAnswered(
                  chosen ? (poll.next[choiceFor(chosen)] ?? null) : null,
                )
              }
            />
          </div>
        ) : (
          <div
            className="ballot__split"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setLean(AT_REST);
            }}
          >
            <Chevron side="left" />
            <Chevron side="right" />
            {(["left", "right"] as const).map((side, index) => (
              <Half
                key={side}
                side={side}
                {...(index === 0 ? { buttonRef: firstSide } : {})}
                label={poll.choices[choiceFor(side)] ?? ""}
                question={poll.question}
                next={nextQuestions[choiceFor(side)]}
                onPick={() => pick(side)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Half({
  side,
  label,
  question,
  next,
  onPick,
  buttonRef,
}: {
  side: Side;
  label: string;
  question: string;
  next: string | undefined;
  onPick: () => void;
  /** Where focus lands when the question is put back to be answered again. */
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  return (
    <button
      type="button"
      className={`ballot__half ballot__half--${side}`}
      aria-label={`${label} - ${question}`}
      onClick={onPick}
      ref={buttonRef}
    >
      <span className="ballot__word">{label}</span>
      {next ? (
        <span className="ballot__next">
          <span className="ballot__eyebrow">NEXT</span>
          <span className="ballot__nextq">{next}</span>
        </span>
      ) : null}
    </button>
  );
}

function Chevron({ side }: { side: Side }) {
  return (
    <svg
      className={`ballot__chev ballot__chev--${side}`}
      width="15"
      height="40"
      viewBox="0 0 15 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={side === "left" ? "M11 6 L5 20 L11 34" : "M4 6 L10 20 L4 34"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
