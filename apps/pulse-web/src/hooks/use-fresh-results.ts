import { useCallback, useEffect, useRef, useState } from "react";
import type { PulseApi, Results } from "../api/types.js";
import { resultsFailure } from "./use-closed-results.js";

/**
 * Where an open question's results stand after the cast's own copy went out
 * of date (#353).
 *
 * The cast answers with the counts as they stood the moment the vote joined
 * them, and the card shows those. One thing on this page makes them wrong
 * while the card is still showing them: signing in afterwards confirms the
 * vote (ADR-0040), so the confirmed number the card shows no longer includes
 * it. `refresh` asks again.
 *
 * While asking, the earlier counts stay on screen - they were true a moment
 * ago, and swapping them for "Loading…" would make the numbers flicker for
 * nothing. If asking fails, `problem` says so in the existing words; `retry`
 * asks again. `clear` drops what was fetched, for when a new cast brings its
 * own counts.
 */
export interface FreshResults {
  results: Results | null;
  problem: string | null;
  refresh: () => void;
  clear: () => void;
}

export function useFreshResults(
  api: PulseApi,
  pollId: string,
  onFresh?: (results: Results) => void,
): FreshResults {
  const [results, setResults] = useState<Results | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Bumped per request, so an answer to an older one never lands. */
  const latest = useRef(0);
  const told = useRef(onFresh);
  told.current = onFresh;

  useEffect(
    () => () => {
      // Nothing that answers after the card has gone may set state on it.
      latest.current += 1;
    },
    [],
  );

  const refresh = useCallback(() => {
    const request = ++latest.current;
    setProblem(null);
    api.results(pollId).then(
      (fresh) => {
        if (request !== latest.current) return;
        setResults(fresh);
        told.current?.(fresh);
      },
      (err: unknown) => {
        if (request === latest.current) setProblem(resultsFailure(err));
      },
    );
  }, [api, pollId]);

  const clear = useCallback(() => {
    latest.current += 1;
    setResults(null);
    setProblem(null);
  }, []);

  return { results, problem, refresh, clear };
}
