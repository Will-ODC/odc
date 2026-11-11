import { useCallback, useState } from "react";
import type { Ballot, PulseApi, Results } from "../api/types.js";
import { ApiError, UNREACHABLE } from "../api/types.js";

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
  /**
   * `refused` when the server answered and turned the vote down, so the
   * earlier answer certainly still stands. Anything else is unknown - the
   * vote may have been stored before the reply went missing - and the screen
   * asks the server which answer it holds. See `refusal`.
   */
  | { status: "failed"; message: string; refused: boolean };

export interface CastVote {
  state: CastState;
  /**
   * Sends the ballot. The promise settles with the state the send ended in,
   * even after the component using this hook has gone, so whoever owns the
   * page can still learn how a send it left behind turned out.
   */
  cast: (ballot: Ballot) => Promise<CastState>;
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
    (ballot: Ballot): Promise<CastState> => {
      // Keep a copy: subsequent controlled picks must not mutate an in-flight vote.
      const submitted = [...ballot];
      const choice = submitted[0];
      // An empty ballot is never a retraction.
      if (choice === undefined) return Promise.resolve({ status: "idle" });
      setState({ status: "casting", choice, ballot: submitted });

      return api.cast(pollId, submitted).then(
        (outcome): CastState => {
          const settled: CastState =
            outcome.status === "closed"
              ? { status: "closed" }
              : {
                  status: "counted",
                  choice,
                  ballot: [...outcome.ballot],
                  changed: outcome.status === "changed",
                  results: outcome.results,
                };
          setState(settled);
          return settled;
        },
        (err: unknown): CastState => {
          const settled: CastState = {
            status: "failed",
            message: reason(err),
            refused: refusal(err),
          };
          setState(settled);
          return settled;
        },
      );
    },
    [api, pollId],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, cast, reset };
}

/**
 * Whether a failed send certainly stored nothing (#527).
 *
 * Only a 4xx is. Every 4xx this route can answer - a bad ballot (400), the
 * origin check (403), no such poll (404), a body too large (413), too many
 * tries (429) - is decided before anything is written, whether pulse or nginx
 * in front of it sent it, so the earlier answer still stands.
 *
 * Everything else is unknown, and the screen asks the server:
 * - status 0: the connection failed or the reply was cut off (`http.ts`);
 *   the vote may have been stored before it went missing.
 * - 5xx: the server, or nginx in front of it (502, 504), failed - possibly
 *   after the vote was written, or while the upstream was still writing it.
 * - a 2xx the app could not read: the server said yes.
 * - anything that is not an ApiError: nothing answered at all.
 */
function refusal(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

/**
 * The sentence to show for a failure. The server's own sentence where it sent
 * one - every refusal from this API is already written to be shown as-is -
 * and otherwise the app-wide one for a lost connection.
 */
function reason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return UNREACHABLE;
}
