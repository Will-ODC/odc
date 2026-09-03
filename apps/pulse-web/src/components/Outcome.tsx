import type { RefObject } from "react";
import type { CastState } from "../hooks/use-cast-vote.js";

/**
 * What happened to the vote, and the way on.
 *
 * The way on is a press rather than a timer. The run is meant to be quick, but
 * quick is not the same as moving on without being told to, and a screen that
 * advances by itself cannot be read by anyone slower than it.
 *
 * A refusal is not shown here. This replaces the ballot, and a vote that was
 * not taken is one the person should be able to try again - see `<Refusal>`.
 */
export function Outcome({
  state,
  label,
  hasNext,
  nextQuestion,
  onNext,
  onSeeResults,
  seeResultsRef,
}: {
  state: CastState;
  /** The choice, in the poll's own words. */
  label: string;
  /**
   * Whether the chosen answer opens another question — read from the poll's
   * own graph, not from whether its preview loaded.
   *
   * These are two different facts and the way on must follow this one. The
   * preview is a nicety fetched over the network; the edge is already in the
   * poll. Gating the button on the preview meant one failed request left
   * someone on the outcome with a run still ahead of them and nothing to press.
   */
  hasNext: boolean;
  /** The next question's wording, when the preview loaded. Label only. */
  nextQuestion?: string | undefined;
  onNext: () => void;
  /**
   * Open the standing of this question. Absent when there is nothing to open -
   * a poll that closed returns no counts, so the control is not drawn rather
   * than drawn dead.
   *
   * Quieter than NEXT on purpose. The run is for answering; the numbers are
   * there for whoever wants them, and are never the thing being offered first.
   */
  onSeeResults?: (() => void) | undefined;
  /**
   * The control focus returns to when the panel closes. Closing unmounts the
   * panel, so without somewhere to send it focus drops to the document body.
   */
  seeResultsRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  if (state.status === "closed") {
    return (
      <div className="outcome" role="status">
        <b>This one has closed.</b>
        <span>Nothing you do here will change it.</span>
      </div>
    );
  }

  if (state.status !== "casting" && state.status !== "counted") return null;

  return (
    <div className="outcome" role="status" aria-live="polite">
      <div className="outcome__mark" aria-hidden="true">
        {"\u2713"}
      </div>
      <b>{label}</b>
      <span>
        {state.status === "casting"
          ? "Sending…"
          : state.changed
            ? "That replaces your earlier answer."
            : "Counted."}
      </span>
      {state.status === "counted" && hasNext ? (
        <button type="button" className="outcome__next" onClick={onNext}>
          <span className="ballot__eyebrow">NEXT</span>
          {/* Named when we know it, and still pressable when we do not. */}
          <span>{nextQuestion ?? "The next question"}</span>
        </button>
      ) : null}
      {state.status === "counted" && onSeeResults ? (
        <button
          type="button"
          className="outcome__results"
          onClick={onSeeResults}
          ref={seeResultsRef}
        >
          See results
        </button>
      ) : null}
    </div>
  );
}
