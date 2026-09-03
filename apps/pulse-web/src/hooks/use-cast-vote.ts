import { useCallback, useState } from "react";
import type { PulseApi, Results } from "../api/types.js";
import { ApiError } from "../api/types.js";

/**
 * Casting one answer.
 *
 * By choice position, not by side: a swipe and a list are two ways of picking
 * the same thing, and only the swipe has sides. The chosen position is carried
 * through `casting` and into `counted` so a screen can keep showing what was
 * picked while the request is in flight, rather than snapping back and then
 * forward again.
 */
export type CastState =
  | { status: "idle" }
  | { status: "casting"; choice: number }
  /**
   * `changed` when this replaced an earlier answer to the same poll.
   *
   * `results` are the counts the server returned with the cast itself, kept
   * rather than discarded: they are the standing of the poll the moment this
   * vote joined it, so showing them costs no second request and cannot
   * disagree with the answer just given.
   */
  | {
      status: "counted";
      choice: number;
      changed: boolean;
      results: Results;
    }
  | { status: "closed" }
  | { status: "failed"; message: string };

export interface CastVote {
  state: CastState;
  cast: (choice: number) => void;
}

/**
 * Refusing a second press is the screen's job, not this hook's: the screen is
 * what knows the answer is given and stops offering the choices. A guard here
 * as well was a second copy of that rule that no test could reach - deleting
 * either one left the suite green, which is the shape this codebase has already
 * had to remove once (PR #91).
 */
export function useCastVote(api: PulseApi, pollId: string): CastVote {
  const [state, setState] = useState<CastState>({ status: "idle" });

  const cast = useCallback(
    (choice: number) => {
      setState({ status: "casting", choice });

      api.cast(pollId, [choice]).then(
        (outcome) => {
          if (outcome.status === "closed") {
            setState({ status: "closed" });
            return;
          }
          setState({
            status: "counted",
            choice,
            changed: outcome.status === "changed",
            results: outcome.results,
          });
        },
        (err: unknown) => setState({ status: "failed", message: reason(err) }),
      );
    },
    [api, pollId],
  );

  return { state, cast };
}

/**
 * The sentence to show for a refusal. The server's own sentence where it sent
 * one - every refusal from this API is already written to be shown as-is.
 */
function reason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "We could not reach the ballot. Check your connection and try again.";
}
