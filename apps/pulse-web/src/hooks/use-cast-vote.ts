import { useCallback, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { Side } from "../flow/swipe.js";
import { ballotFor } from "../flow/swipe.js";

/**
 * Casting one swipe.
 *
 * The side is carried through `casting` and into `counted` so the screen can
 * keep showing which way the person swiped while the request is in flight,
 * rather than snapping back and then forward again.
 */
export type CastState =
  | { status: "idle" }
  | { status: "casting"; side: Side }
  /** `changed` when this replaced an earlier answer to the same poll. */
  | { status: "counted"; side: Side; changed: boolean }
  | { status: "closed" }
  | { status: "failed"; message: string };

export interface CastVote {
  state: CastState;
  cast: (side: Side) => void;
}

export function useCastVote(api: PulseApi, pollId: string): CastVote {
  const [state, setState] = useState<CastState>({ status: "idle" });

  const cast = useCallback(
    (side: Side) => {
      // One swipe is one vote. A second press while the first is in flight, or
      // after it has landed, is the same person pressing twice — not a change
      // of mind — so it is ignored rather than sent.
      setState((current) => {
        if (current.status !== "idle" && current.status !== "failed") {
          return current;
        }

        api.cast(pollId, ballotFor(side)).then(
          (outcome) => {
            if (outcome.status === "closed") {
              setState({ status: "closed" });
              return;
            }
            setState({
              status: "counted",
              side,
              changed: outcome.status === "changed",
            });
          },
          (err: unknown) =>
            setState({ status: "failed", message: reason(err) }),
        );

        return { status: "casting", side };
      });
    },
    [api, pollId],
  );

  return { state, cast };
}

function reason(err: unknown): string {
  // 401 is the one refusal that is not a fault: the server takes a vote only
  // from someone it knows, and nothing has signed this person in yet.
  if (err instanceof ApiError && err.status === 401) {
    return "We could not count that yet — this ballot needs you signed in first.";
  }
  if (err instanceof ApiError) return err.message;
  return "We could not reach the ballot. Check your connection and try again.";
}
