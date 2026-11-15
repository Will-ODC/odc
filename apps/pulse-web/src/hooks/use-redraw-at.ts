import { useEffect, useReducer } from "react";

/** The longest wait a browser timer holds; a later time is waited for in steps. */
const LONGEST_WAIT_MS = 2 ** 31 - 1;

/**
 * Draws the component again at `at` (epoch milliseconds), so what it works
 * out from the clock, such as a question closing, shows without the person
 * moving (#589). Nothing is scheduled while `at` is undefined.
 */
export function useRedrawAt(at: number | undefined): void {
  const [drawn, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (at === undefined) return;
    const wait = Math.min(Math.max(at - Date.now(), 0), LONGEST_WAIT_MS);
    const timer = setTimeout(redraw, wait);
    return () => clearTimeout(timer);
    // `drawn` sets the timer again when one redraw was not yet late enough.
  }, [at, drawn]);
}
