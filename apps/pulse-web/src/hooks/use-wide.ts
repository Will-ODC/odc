import { useEffect, useState } from "react";

/** The desktop layout's width, matching the CSS's phone breakpoint (699px). */
export const WIDE = "(min-width: 700px)";

/**
 * Whether the window is desktop width (#490), kept current as it resizes.
 * Where the browser cannot say (no `matchMedia`, as in tests), it is the
 * phone layout.
 */
export function useWide(media = WIDE): boolean {
  const [wide, setWide] = useState(() => query(media)?.matches ?? false);
  useEffect(() => {
    const list = query(media);
    if (!list) return;
    const changed = () => setWide(list.matches);
    changed();
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, [media]);
  return wide;
}

function query(media: string): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(media)
    : null;
}
