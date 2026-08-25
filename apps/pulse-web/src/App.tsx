import type { PulseApi } from "./api/types.js";
import { SwipeBallot } from "./screens/SwipeBallot.js";
import "./styles/tokens.css";
import "./App.css";

/**
 * Picks the screen for where the person is, and owns no screen markup itself.
 *
 * There is one screen so far, and it is deliberately the first thing anyone
 * sees: pulse opens on the vote, not on a sign-in form. The sign-in step comes
 * after the first swipe, and verifies the vote rather than gating it.
 */
export function App({ api, pollId }: { api: PulseApi; pollId: string }) {
  return (
    <SwipeBallot
      api={api}
      pollId={pollId}
      nextQuestions={["Which ads are allowed?", "How do we pay for it?"]}
    />
  );
}
