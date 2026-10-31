import { useEffect, useRef } from "react";
import type { Ballot, PulseApi, Results } from "../api/types.js";

export interface SavedAnswer {
  ballot: Ballot;
  results: Results;
}

/**
 * Finds the answer this browser already gave to an open question, so coming
 * back shows the same page as just after voting.
 *
 * Failing to find it is not an error on the page: the ballot still works, and
 * casting replaces whatever is stored, so `onFound` simply never runs. The
 * results load only once a ballot exists, so nobody who has not answered
 * triggers a results request.
 */
export function useSavedAnswer(
  api: PulseApi,
  pollId: string,
  /** The poll is closed, or this visit already holds the answer. */
  skip: boolean,
  onFound: (saved: SavedAnswer) => void,
): void {
  const told = useRef(onFound);
  told.current = onFound;

  useEffect(() => {
    if (skip) return;
    let live = true;
    api
      .myBallot(pollId)
      .then(async (ballot) => {
        if (ballot === null) return;
        const results = await api.results(pollId);
        if (live) told.current({ ballot, results });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, pollId, skip]);
}
