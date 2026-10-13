import type { RefObject } from "react";
import type { Standing } from "../hooks/use-closed-results.js";
import type { ViewData } from "../hooks/view-data.js";
import { ResultsPanel } from "./ResultsPanel.js";
import { ViewState } from "./ViewState.js";

/**
 * A closed question's results, in place of the question, once asked for.
 *
 * Unlike `<VoteCard>`, the counts are not already in hand - they are fetched
 * when "See results" is pressed - so this owes the other states too: loading,
 * and a failure with a way to try again. The empty state is the panel's own:
 * nobody answering is said in `<ResultsPanel>`, which keeps its way out.
 *
 * Every state carries Close, so someone who asked and then changed their mind
 * is never stuck waiting on a request to get back to the question.
 */
export function ClosedResults({
  data,
  onRetry,
  onClose,
  panelRef,
  explainHref,
}: {
  data: ViewData<Standing>;
  onRetry: () => void;
  onClose: () => void;
  /** Focus lands here on open, and on each change of state while open. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Where "What does this mean?" points (`/trust`); omit to leave it out. */
  explainHref?: string;
}) {
  if (data.status === "ready") {
    return (
      <ResultsPanel
        results={data.value.results}
        yourChoices={data.value.yourChoices}
        ended
        onClose={onClose}
        panelRef={panelRef}
        explainHref={explainHref}
      />
    );
  }

  return (
    <div
      className="results"
      role="group"
      aria-label="How people answered"
      ref={panelRef}
      tabIndex={-1}
    >
      <button
        type="button"
        className="results__close"
        aria-label="Close"
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <ViewState data={data}>{() => null}</ViewState>
      {data.status === "error" ? (
        <button type="button" className="results__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
