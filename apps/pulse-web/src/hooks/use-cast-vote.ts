import { useCallback, useState } from "react";
import type { Ballot, PulseApi, Results } from "../api/types.js";
import { ApiError } from "../api/types.js";

/** Keeps the whole ballot through sending, results and retries.
 * `choice` remains first-choice metadata for existing hook consumers; card
 * selection and approval submission use `ballot`.
 */
export type CastState =
  | { status: "idle" }
  | { status: "casting"; choice: number; ballot: Ballot }
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
      ballot: Ballot;
      changed: boolean;
      results: Results;
    }
  | { status: "closed" }
  | { status: "failed"; message: string };

export interface CastVote {
  state: CastState;
  cast: (ballot: Ballot) => void;
  /**
   * Put the question back, so the answer can be given again.
   *
   * Not an undo — nothing is retracted, and the vote already cast stands until
   * another replaces it. This only returns the screen to `idle`, which is what
   * makes the ballot answerable again. An empty ballot is refused by the API
   * and is never read as a retraction, so there is no way to un-vote and this
   * does not pretend to be one.
   */
  reset: () => void;
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
    (ballot: Ballot) => {
      // Keep a copy: subsequent controlled picks must not mutate an in-flight vote.
      const submitted = [...ballot];
      const choice = submitted[0];
      if (choice === undefined) return; // An empty ballot is never a retraction.
      setState({ status: "casting", choice, ballot: submitted });

      api.cast(pollId, submitted).then(
        (outcome) => {
          if (outcome.status === "closed") {
            setState({ status: "closed" });
            return;
          }
          setState({
            status: "counted",
            choice,
            ballot: [...outcome.ballot],
            changed: outcome.status === "changed",
            results: outcome.results,
          });
        },
        (err: unknown) => setState({ status: "failed", message: reason(err) }),
      );
    },
    [api, pollId],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, cast, reset };
}

/**
 * The sentence to show for a refusal. The server's own sentence where it sent
 * one - every refusal from this API is already written to be shown as-is.
 */
function reason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "We could not reach the ballot. Check your connection and try again.";
}
