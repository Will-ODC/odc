import type { RefObject } from "react";
import type { CastState } from "../hooks/use-cast-vote.js";

/**
 * What happened to the vote.
 *
 * The way on is not here — `<NextButton>` stands beside this, because it also
 * stands beside the results panel that can replace this. See `<AfterVote>`.
 *
 * A refusal is not shown here. This replaces the ballot, and a vote that was
 * not taken is one the person should be able to try again - see `<Refusal>`.
 */
export function Outcome({
  state,
  label,
  changeable,
  onChange,
  onSeeResults,
  seeResultsRef,
}: {
  state: CastState;
  /** The choice, in the poll's own words. */
  label: string;
  /**
   * Whether this answer can still be replaced — the poll is open.
   *
   * Pulse casts on one press with no confirming second press, which is only
   * safe because an answer is not final. That bargain is worth nothing unless
   * the person is told about the second half of it, so this sentence is not
   * decoration: it is what stands in for the confirmation step. It is a prop
   * rather than an assumption because a promise that a vote can be changed
   * must not be printed on a poll where it cannot.
   */
  changeable: boolean;
  /**
   * Put the question back so the answer can be given again. Present exactly
   * when `changeable` is true — the sentence above promises this control
   * exists, so the two must never disagree.
   */
  onChange: () => void;
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
      {state.status === "counted" && changeable ? (
        <span className="outcome__changeable">
          You can change your answer until this question closes.
        </span>
      ) : null}
      {state.status === "counted" && changeable ? (
        <button type="button" className="outcome__change" onClick={onChange}>
          Change my answer
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
