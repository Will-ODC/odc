import { useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "../flow/route.js";
import { pathOf, routeFrom } from "../flow/route.js";

/**
 * Where we are, and how to go somewhere else.
 *
 * Hand-rolled rather than a router dependency: pulse has three places to be,
 * `flow/route.ts` already decides which one a URL means, and the run keeps its
 * own history in a trail of poll ids. A router would own that trail too, and
 * the trail is not a URL — two different answers can open the same question,
 * so where you came from is a property of the walk rather than of the address.
 *
 * The href is kept as a string rather than a `Route` because a `Route` is a
 * fresh object every render and would never compare equal to itself.
 *
 * There is deliberately no `go` — no push. Every move this app makes today is
 * away from a sign-in URL that must not come back, and a `go` that nothing
 * called was a method whose history entry no test could exercise. Add it with
 * the first screen that genuinely wants a way back.
 */
export function useRoute(): {
  route: Route;
  /**
   * Somewhere new, replacing here.
   *
   * What a spent sign-in link needs: the token is gone the moment it is
   * redeemed, so leaving that URL in the history hands the back button a page
   * that can only answer "already used".
   */
  replace: (to: Route) => void;
} {
  const [href, setHref] = useState(() => globalThis.location.href);

  useEffect(() => {
    const onPop = () => setHref(globalThis.location.href);
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);

  const replace = useCallback((to: Route) => {
    globalThis.history.replaceState(null, "", pathOf(to));
    setHref(globalThis.location.href);
  }, []);

  return { route: useMemo(() => routeFrom(href), [href]), replace };
}
