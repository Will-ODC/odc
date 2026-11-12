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
 * nobody answering is said in `<ResultsPanel>`.
 *
 * Loading and failure carry Close, so someone who asked and then changed
 * their mind is never stuck waiting on a request to get back to the question.
 * Once the results are in they are the question page's compact panel, which
 * has never drawn a Close of its own; the full panel's Close, reached only
 * through a `compact={false}` no page passed, went in #569.
 */
export function ClosedResults({
  data,
  compact,
  onRetry,
  onClose,
  panelRef,
  explainHref,
}: {
  data: ViewData<Standing>;
  /** The question page's compact results layout, the only one this draws. */
  compact: true;
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
        compact={compact}
        yourChoices={data.value.yourChoices}
        ended
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
