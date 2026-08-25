import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Poll, PulseApi } from "../api/types.js";
import type { Lean, Side } from "../flow/swipe.js";
import {
  COMMIT_DISTANCE,
  isSwipeable,
  leanOf,
  releaseOf,
  sideOfKey,
  sideOfPoint,
} from "../flow/swipe.js";
import { usePoll } from "../hooks/use-poll.js";
import { useCastVote } from "../hooks/use-cast-vote.js";
import type { ViewData } from "../hooks/view-data.js";
import { ViewState } from "../components/ViewState.js";
import "./SwipeBallot.css";

const AT_REST: Lean = { side: null, strength: 0 };

/** A drag shorter than this is a tap that wobbled, not a drag. */
const DRAG_SLOP = 4;

export interface SwipeBallotProps {
  api: PulseApi;
  pollId: string;
  /**
   * The question each side opens next, left first.
   *
   * Pulse is meant to be a graph of linked votes rather than one poll, but
   * nothing on the server models that link yet. Passing the two questions in
   * keeps the screen able to show the graph without inventing a field the API
   * does not have.
   */
  nextQuestions?: readonly [string, string];
}

export function SwipeBallot({ api, pollId, nextQuestions }: SwipeBallotProps) {
  const loaded = usePoll(api, pollId);
  const { state, cast } = useCastVote(api, pollId);
  const [lean, setLean] = useState<Lean>(AT_REST);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);

  // A poll this screen cannot ask is not a fault and not a blank — it is a
  // sentence saying so, which is what `empty` is for.
  const data: ViewData<Poll> =
    loaded.status === "ready" && !isSwipeable(loaded.value)
      ? {
          status: "empty",
          message: "This question takes more than a yes or a no.",
        }
      : loaded;

  const settled =
    state.status === "casting" ||
    state.status === "counted" ||
    state.status === "closed";
  const chosen =
    state.status === "casting" || state.status === "counted"
      ? state.side
      : null;

  function commit(side: Side) {
    setLean({ side, strength: 1 });
    cast(side);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (settled) return;
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
    const released = releaseOf(dx);
    if (released) return commit(released);

    // A press that never travelled is a tap, and a tap picks the half it landed
    // on. Anything else springs back.
    if (!held.moved) {
      const box = event.currentTarget.getBoundingClientRect();
      return commit(sideOfPoint(event.clientX - box.left, box.width));
    }
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

      <ViewState data={data}>
        {(poll) => (
          <>
            <div className="ballot__content" hidden={settled}>
              <header className="ballot__head">
                <div className="ballot__brand">
                  <i aria-hidden="true" /> pulse
                </div>
                <PrivacyMark />
                <span className="ballot__chip">{chipFor(poll)}</span>
                <h1 className="ballot__question">{poll.question}</h1>
              </header>

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
                <Half
                  side="left"
                  label={poll.choices[0] ?? ""}
                  question={poll.question}
                  {...(nextQuestions ? { next: nextQuestions[0] } : {})}
                  onPick={() => {
                    if (!drag.current?.moved) commit("left");
                  }}
                />
                <Half
                  side="right"
                  label={poll.choices[1] ?? ""}
                  question={poll.question}
                  {...(nextQuestions ? { next: nextQuestions[1] } : {})}
                  onPick={() => {
                    if (!drag.current?.moved) commit("right");
                  }}
                />
              </div>
            </div>

            {settled ? (
              <div className="ballot__done" role="status" aria-live="polite">
                <Outcome
                  poll={poll}
                  state={state}
                  {...(nextQuestions ? { nextQuestions } : {})}
                />
              </div>
            ) : null}
          </>
        )}
      </ViewState>

      {state.status === "failed" ? (
        <div className="ballot__done" role="alert">
          <b>{state.message}</b>
        </div>
      ) : null}
    </section>
  );
}

function Outcome({
  poll,
  state,
  nextQuestions,
}: {
  poll: Poll;
  state: ReturnType<typeof useCastVote>["state"];
  nextQuestions?: readonly [string, string];
}) {
  if (state.status === "closed") {
    return (
      <>
        <b>This one has closed.</b>
        <span>You can still see where it landed.</span>
      </>
    );
  }
  if (state.status !== "casting" && state.status !== "counted") return null;

  const label = poll.choices[state.side === "left" ? 0 : 1] ?? "";
  const next = nextQuestions?.[state.side === "left" ? 0 : 1];

  return (
    <>
      <div className="ballot__mark" aria-hidden="true">
        ✓
      </div>
      <b>{label}</b>
      <span>
        {state.status === "casting"
          ? "Sending…"
          : state.changed
            ? `That replaces your earlier answer.${next ? ` Next: ${next}` : ""}`
            : `Counted.${next ? ` Next: ${next}` : ""}`}
      </span>
    </>
  );
}

function Half({
  side,
  label,
  question,
  next,
  onPick,
}: {
  side: Side;
  label: string;
  question: string;
  next?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ballot__half ballot__half--${side}`}
      aria-label={`${label} — ${question}`}
      onClick={onPick}
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

/** The incognito motif: this vote is yours, and stays that way. */
function PrivacyMark() {
  return (
    <svg
      width="92"
      height="83"
      viewBox="0 0 132 120"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M44 62 C44 34 55 26 66 26 C77 26 88 34 88 62 Z"
        fill="rgba(255,255,255,.92)"
      />
      <ellipse cx="66" cy="63" rx="46" ry="8.5" fill="rgba(255,255,255,.92)" />
      <path
        d="M30 80 h10"
        stroke="rgba(255,255,255,.8)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M92 80 h10"
        stroke="rgba(255,255,255,.8)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="38"
        y="74"
        width="26"
        height="18"
        rx="9"
        fill="rgba(255,255,255,.12)"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
      />
      <rect
        x="68"
        y="74"
        width="26"
        height="18"
        rx="9"
        fill="rgba(255,255,255,.12)"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
      />
      <path
        d="M64 81 h4"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** "Official Ballot", and when it closes if the poll says. */
function chipFor(poll: Poll): string {
  if (!poll.closesAt) return "Official Ballot";
  const closes = new Date(poll.closesAt);
  if (Number.isNaN(closes.getTime())) return "Official Ballot";
  const day = closes.toLocaleDateString(undefined, { weekday: "long" });
  return `Official Ballot · Closes ${day}`;
}

export { COMMIT_DISTANCE };
