// The buttons wear the card's "Next question" look, defined once there.
import "./VoteCard.css";
import "./QuestionPager.css";

export interface MyVotesNavigation {
  previous: { question: string; onOpen: () => void } | null;
  next: { question: string; onOpen: () => void } | null;
}

/** Previous and Next through My votes, including disabled list ends. */
export function QuestionPager({
  navigation,
}: {
  navigation: MyVotesNavigation;
}) {
  return (
    <span className="question-pager">
      <button
        type="button"
        className="vote-card__next"
        disabled={!navigation.previous}
        aria-label={
          navigation.previous
            ? `Previous question: ${navigation.previous.question}`
            : "No previous question"
        }
        onClick={() => navigation.previous?.onOpen()}
      >
        <span aria-hidden="true">‹ </span>Previous
      </button>
      <button
        type="button"
        className="vote-card__next"
        disabled={!navigation.next}
        aria-label={
          navigation.next
            ? `Next question: ${navigation.next.question}`
            : "No next question"
        }
        onClick={() => navigation.next?.onOpen()}
      >
        Next<span aria-hidden="true"> ›</span>
      </button>
    </span>
  );
}
