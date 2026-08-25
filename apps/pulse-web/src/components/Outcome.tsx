import type { CastState } from "../hooks/use-cast-vote.js";

/**
 * What happened to the vote, and the way on.
 *
 * The way on is a press rather than a timer. The run is meant to be quick, but
 * quick is not the same as moving on without being told to, and a screen that
 * advances by itself cannot be read by anyone slower than it.
 *
 * A refusal is not shown here. This covers the ballot, and a vote that was not
 * taken is one the person should be able to try again - see `<Refusal>`.
 */
export function Outcome({
  state,
  label,
  nextQuestion,
  onNext,
}: {
  state: CastState;
  /** The choice, in the poll's own words. */
  label: string;
  nextQuestion?: string | undefined;
  onNext: () => void;
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
      {state.status === "counted" && nextQuestion ? (
        <button type="button" className="outcome__next" onClick={onNext}>
          <span className="ballot__eyebrow">NEXT</span>
          <span>{nextQuestion}</span>
        </button>
      ) : null}
    </div>
  );
}
