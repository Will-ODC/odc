import { useCallback, useState } from "react";
import type { Poll, PulseApi } from "./api/types.js";
import { isSwipeable } from "./flow/swipe.js";
import { usePoll } from "./hooks/use-poll.js";
import { ViewState } from "./components/ViewState.js";
import { SwipeBallot } from "./screens/SwipeBallot.js";
import { ChoiceBallot } from "./screens/ChoiceBallot.js";
import "./styles/tokens.css";
import "./App.css";

/**
 * Walks the run.
 *
 * pulse opens on a vote, not a sign-in form, and answering is also navigating:
 * each choice names the poll it opens, so the run is a path through a graph
 * rather than a fixed list of screens. This component holds where we are and
 * picks the screen the current question needs; the screens do the asking.
 *
 * Where we are is the end of a trail rather than a single id, because a
 * question does not know what came before it: two different answers can open
 * the same poll, so "the previous question" is a property of the walk and not
 * of the graph. Keeping the path taken is the only way back.
 */
export function App({ api, pollId }: { api: PulseApi; pollId: string }) {
  const [trail, setTrail] = useState<string[]>([pollId]);
  const at = trail[trail.length - 1] ?? pollId;
  const loaded = usePoll(api, at);

  const answered = useCallback((next: string | null) => {
    // A choice with nothing after it ends the run. Staying put is the honest
    // thing until there is a screen to end on.
    if (next) setTrail((walked) => [...walked, next]);
  }, []);

  /**
   * Back is a step off the end of the trail, not a re-walk of the graph.
   *
   * The question it returns to is asked again from the top rather than shown
   * with the earlier answer on it: an answer can be changed until the question
   * closes, so the ballot is still the truthful screen, and the server says
   * plainly that a second vote replaced the first.
   */
  const back = useCallback(() => {
    setTrail((walked) => (walked.length > 1 ? walked.slice(0, -1) : walked));
  }, []);

  return (
    <ViewState data={loaded}>
      {(poll) => (
        <Ballot
          api={api}
          poll={poll}
          onAnswered={answered}
          // Nothing to go back to on the question the run opened on, and a
          // control that would do nothing should not be on the screen.
          {...(trail.length > 1 ? { onBack: back } : {})}
        />
      )}
    </ViewState>
  );
}

/**
 * Which ballot a question needs is a property of the question: two choices are
 * a swipe, more than two are a list. Keyed by poll id so moving to the next
 * question starts a fresh screen rather than showing the last one's answer.
 */
function Ballot({
  api,
  poll,
  onAnswered,
  onBack,
}: {
  api: PulseApi;
  poll: Poll;
  onAnswered: (next: string | null) => void;
  onBack?: (() => void) | undefined;
}) {
  const shared = { api, poll, onAnswered, ...(onBack ? { onBack } : {}) };
  return isSwipeable(poll) ? (
    <SwipeBallot key={poll.id} {...shared} />
  ) : (
    <ChoiceBallot key={poll.id} {...shared} />
  );
}
