/**
 * The way on to the question this answer opens.
 *
 * Its own component because it stands beside two different things: the
 * outcome, and the results panel that can be opened in place of the outcome.
 * A run is meant to move at the speed of an opinion, so glancing at the
 * numbers must not cost a press to undo before you can carry on — which means
 * this button outlives whichever of the two is showing, and so cannot live
 * inside either of them.
 */
export function NextButton({
  nextQuestion,
  onNext,
}: {
  /** The next question's wording, when the preview loaded. Label only. */
  nextQuestion?: string | undefined;
  onNext: () => void;
}) {
  return (
    <button type="button" className="outcome__next" onClick={onNext}>
      <span className="ballot__eyebrow">NEXT</span>
      {/* Named when we know it, and still pressable when we do not. */}
      <span>{nextQuestion ?? "The next question"}</span>
    </button>
  );
}
