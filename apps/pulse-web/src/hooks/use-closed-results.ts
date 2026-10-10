import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PulseApi, Results } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

/** What a closed question's results panel needs: the counts, and your mark. */
export interface Standing {
  results: Results;
  /**
   * The choices this browser gave before the poll closed: the whole ballot,
   * since an `approval` poll takes several. Empty if it gave none.
   */
  yourChoices: readonly number[];
}

export interface ClosedResults {
  /** Whether the results are open, in place of the closed question. */
  showing: boolean;
  /** `loading` until the first open; what the panel should show after it. */
  data: ViewData<Standing>;
  /** "See results": show the panel, and fetch if there is nothing to show. */
  open: () => void;
  /** "Try again", after a fetch that failed. */
  retry: () => void;
  /** "Close": back to the closed question. */
  close: () => void;
  /** On the "See results" control. Focus returns here on close. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** On whatever stands in the panel's place. Focus lands here on open. */
  panelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The results of a poll that has already closed, for anyone who asks.
 *
 * Fetched when "See results" is pressed, not when the closed question
 * arrives: most people reading a closed question will not ask, and a fetch on
 * arrival would be spent on every one of them. Once loaded they are kept - a
 * closed poll's results cannot change - so closing and reopening fetches
 * nothing. A failed fetch is not kept: reopening tries again.
 *
 * This browser's own answer is fetched alongside, and is optional in the
 * strict sense: if it will not load, the results show without "yours" rather
 * than the whole panel failing over a mark.
 *
 * Focus follows the same pattern as `<AfterVote>`: into the panel on open,
 * back to the trigger on close, and nowhere on first render.
 */
export function useClosedResults(api: PulseApi, pollId: string): ClosedResults {
  const [showing, setShowing] = useState(false);
  const [data, setData] = useState<ViewData<Standing>>({ status: "loading" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  /** Bumped per request, so an answer to an older one never lands. */
  const latest = useRef(0);

  useEffect(
    () => () => {
      // Nothing that answers after the screen has gone may set state on it.
      latest.current += 1;
    },
    [],
  );

  const load = useCallback(() => {
    const request = ++latest.current;
    setData({ status: "loading" });
    Promise.all([
      api.results(pollId),
      api.myBallot(pollId).then(
        (ballot) => ballot ?? [],
        () => [],
      ),
    ]).then(
      ([results, yourChoices]) => {
        if (request === latest.current) {
          setData({ status: "ready", value: { results, yourChoices } });
        }
      },
      (err: unknown) => {
        if (request === latest.current) {
          setData({ status: "error", message: reason(err) });
        }
      },
    );
  }, [api, pollId]);

  const open = useCallback(() => {
    setShowing(true);
    if (data.status !== "ready") load();
  }, [data.status, load]);

  const close = useCallback(() => setShowing(false), []);

  /**
   * Focus follows what is on screen while the panel is open, not only the
   * moment it opens: the loading line, the failure, and the counts are three
   * different elements, and the control pressed to move between them ("Try
   * again") is unmounted by the move. Without this, focus falls to the body.
   */
  useEffect(() => {
    if (showing) {
      opened.current = true;
      panelRef.current?.focus();
    } else if (opened.current) {
      opened.current = false;
      triggerRef.current?.focus();
    }
  }, [showing, data.status]);

  return { showing, data, open, retry: load, close, triggerRef, panelRef };
}

function reason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "We could not load the results. Check your connection and try again.";
}
