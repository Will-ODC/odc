import "./Rail.css";
import "./NextUp.css";

/** What one answer on the current ballot opens. */
export interface NextItem {
  /** The answer, worded as the ballot words it — "No", "Yes". */
  answer: string;
  /** The question it opens, when the preview loaded. */
  question?: string | undefined;
}

/**
 * The right rail: where each answer leads.
 *
 * The run is a graph and the ballot already says so in miniature, under each
 * side. On a wide screen there is room to say it properly — one row per
 * answer, the answer and the question it opens — which is the thing a phone
 * has no space for and the reason this rail is worth having rather than
 * being a second copy of the screen.
 *
 * Three of the four states, and deliberately not the fourth: a preview that
 * fails to load arrives here as a row with no question rather than as an
 * error, because `useNextQuestions` already decided that failing to show
 * what comes next is no reason to interrupt the vote in front of someone.
 * The row is still shown, because the edge is a fact about the poll even
 * when its wording did not arrive.
 */
export function NextUp({ items }: { items: readonly NextItem[] }) {
  return (
    /*
     * Labelled by its own text rather than by `aria-labelledby`: an id is
     * global, and the first time two of these render the page has two
     * elements answering to the same one.
     */
    <section className="rail-next" aria-label="Where this goes">
      <h2 className="rail__heading">Where this goes</h2>

      {items.length === 0 ? (
        <p className="rail-next__empty">
          Nothing follows this one yet. Your answer is the end of the run.
        </p>
      ) : (
        <ul className="rail-next__list">
          {/* Keyed by position: two answers may legitimately read the same. */}
          {items.map((item, index) => (
            <li className="rail-next__item" key={`${index}-${item.answer}`}>
              <span className="rail-next__answer">{item.answer}</span>
              <span className="rail-next__question">
                {item.question ?? "The next question"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
