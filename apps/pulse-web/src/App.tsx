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
 */
export function App({ api, pollId }: { api: PulseApi; pollId: string }) {
  const [at, setAt] = useState(pollId);
  const loaded = usePoll(api, at);

  const answered = useCallback((next: string | null) => {
    // A choice with nothing after it ends the run. Staying put is the honest
    // thing until there is a screen to end on.
    if (next) setAt(next);
  }, []);

  return (
    <ViewState data={loaded}>
      {(poll) => <Ballot api={api} poll={poll} onAnswered={answered} />}
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
}: {
  api: PulseApi;
  poll: Poll;
  onAnswered: (next: string | null) => void;
}) {
  return isSwipeable(poll) ? (
    <SwipeBallot key={poll.id} api={api} poll={poll} onAnswered={onAnswered} />
  ) : (
    <ChoiceBallot key={poll.id} api={api} poll={poll} onAnswered={onAnswered} />
  );
}
