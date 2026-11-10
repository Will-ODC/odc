import { useEffect, useState } from "react";

/** The desktop layout's width, matching the CSS's phone breakpoint (699px). */
export const WIDE = "(min-width: 700px)";

/**
 * Whether the window is desktop width (#490), kept current as it resizes.
 * Where the browser cannot say (no `matchMedia`, as in tests), it is the
 * phone layout.
 */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const changed = () => setWide(list.matches);
    changed();
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, []);
  return wide;
}

function query(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(WIDE)
    : null;
}
