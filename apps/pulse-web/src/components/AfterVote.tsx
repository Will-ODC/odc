import { useEffect, useRef, useState } from "react";
import type { CastState } from "../hooks/use-cast-vote.js";
import { NextButton } from "./NextButton.js";
import { Outcome } from "./Outcome.js";
import { ResultsPanel } from "./ResultsPanel.js";

/**
 * What stands where the ballot was, once an answer is in: the outcome, or the
 * standing of the question when someone asks to see it - and, under either of
 * them, the way on.
 *
 * Both ballots need this pair and neither needs to know which of the two is
 * showing, so the toggle lives here rather than twice in the screens. It is
 * local by rights - nothing above it changes when someone looks at the
 * numbers and looks away again.
 *
 * NEXT sits outside that toggle deliberately. It used to live inside the
 * outcome, so opening the numbers took the only way forward off the screen
 * and a glance cost "Close" and then NEXT. A run is meant to move at the
 * speed of an opinion; making a glance cost two presses to undo teaches
 * people not to glance.
 *
 * The counts come from the cast itself (`CastState`), not from a fetch of
 * their own: the server returns them with the vote, so there is nothing to
 * load, nothing to fail, and no window in which the numbers can disagree with
 * the answer that was just given.
 */
export function AfterVote({
  state,
  label,
  changeable,
  hasNext,
  nextQuestion,
  onNext,
}: {
  state: CastState;
  label: string;
  /** Whether the answer can still be replaced. See `<Outcome>`. */
  changeable: boolean;
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
}) {
  const [showing, setShowing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Only send focus back to the trigger when this component closed the panel -
   * never on first render, where nothing was opened and the person is reading
   * the outcome for the first time.
   */
  const opened = useRef(false);

  useEffect(() => {
    if (showing) {
      opened.current = true;
      panelRef.current?.focus();
    } else if (opened.current) {
      opened.current = false;
      triggerRef.current?.focus();
    }
  }, [showing]);

  /**
   * The way on is a press rather than a timer. The run is meant to be quick,
   * but quick is not the same as moving on without being told to, and a screen
   * that advances by itself cannot be read by anyone slower than it.
   */
  const wayOn =
    state.status === "counted" && hasNext ? (
      <NextButton
        {...(nextQuestion === undefined ? {} : { nextQuestion })}
        onNext={onNext}
      />
    ) : null;

  if (showing && state.status === "counted") {
    return (
      <>
        <ResultsPanel
          results={state.results}
          yourChoice={state.choice}
          onClose={() => setShowing(false)}
          panelRef={panelRef}
        />
        {wayOn}
      </>
    );
  }

  return (
    <>
      <Outcome
        state={state}
        label={label}
        changeable={changeable}
        // Only a counted vote has counts to show. `casting` has not been
        // answered yet and `closed` came back without them.
        {...(state.status === "counted"
          ? { onSeeResults: () => setShowing(true), seeResultsRef: triggerRef }
          : {})}
      />
      {wayOn}
    </>
  );
}
