import { useState } from "react";
import type { CastState } from "../hooks/use-cast-vote.js";
import { Outcome } from "./Outcome.js";
import { ResultsPanel } from "./ResultsPanel.js";

/**
 * What stands where the ballot was, once an answer is in: the outcome, or the
 * standing of the question when someone asks to see it.
 *
 * Both ballots need this pair and neither needs to know which of the two is
 * showing, so the toggle lives here rather than twice in the screens. It is
 * local by rights - nothing above it changes when someone looks at the
 * numbers and looks away again.
 *
 * The counts come from the cast itself (`CastState`), not from a fetch of
 * their own: the server returns them with the vote, so there is nothing to
 * load, nothing to fail, and no window in which the numbers can disagree with
 * the answer that was just given.
 */
export function AfterVote({
  state,
  label,
  hasNext,
  nextQuestion,
  onNext,
}: {
  state: CastState;
  label: string;
  hasNext: boolean;
  nextQuestion?: string | undefined;
  onNext: () => void;
}) {
  const [showing, setShowing] = useState(false);

  if (showing && state.status === "counted") {
    return (
      <ResultsPanel
        results={state.results}
        yourChoice={state.choice}
        onClose={() => setShowing(false)}
      />
    );
  }

  return (
    <Outcome
      state={state}
      label={label}
      hasNext={hasNext}
      {...(nextQuestion === undefined ? {} : { nextQuestion })}
      onNext={onNext}
      // Only a counted vote has counts to show. `casting` has not been
      // answered yet and `closed` came back without them.
      {...(state.status === "counted"
        ? { onSeeResults: () => setShowing(true) }
        : {})}
    />
  );
}
