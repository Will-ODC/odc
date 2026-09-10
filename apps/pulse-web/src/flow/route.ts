/**
 * Which part of pulse a URL points at.
 *
 * Pure on purpose, like `story.ts` and `swipe.ts`: reading a URL is a decision
 * with edge cases worth testing exhaustively, and none of them need React.
 *
 * There are three places to be, and the emailed sign-in link is the reason the
 * first two exist. `apps/pulse/src/dev-server.ts` builds that link as
 * `<web origin>/sign-in?token=…`, so the client has to answer that path or the
 * link goes nowhere — which is precisely what it did before this module: the
 * app read `?poll=`, found nothing, and opened the first question as though
 * nobody had clicked anything.
 */
export type Route =
  /** Walking the graph of questions, starting at `pollId`. */
  | { kind: "run"; pollId: string }
  /** Asking for a sign-in link. */
  | { kind: "signIn" }
  /** Arrived from the emailed link, holding a token to spend. */
  | { kind: "redeem"; token: string };

/**
 * Where a run begins when the URL does not say.
 *
 * Matches `FIRST_POLL_ID` in the dev server's seed. It is a client-side
 * default rather than a fact about the graph: once questions can be authored
 * and browsed, where to start is a server answer, not a constant.
 */
export const FIRST_POLL_ID = "ads-free";

const SIGN_IN_PATH = "/sign-in";

/**
 * A base for parsing, never for navigating.
 *
 * `new URL` refuses a relative string without one, and tests hand this
 * function paths rather than absolute hrefs. Nothing reads the host back, and
 * `.invalid` is reserved by RFC 2606 so a bug that did leak it cannot resolve.
 */
const PARSE_BASE = "http://pulse.invalid";

export function routeFrom(href: string): Route {
  const url = new URL(href, PARSE_BASE);
  /*
   * Trailing slashes are the same place, and so is a different case: a link
   * that gains a slash or gets title-cased on the way through a mail client
   * should still sign the person in. Getting this wrong is the original bug in
   * miniature — an unrecognised path falls through to the run and the token is
   * dropped in silence.
   */
  const path = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";

  if (path === SIGN_IN_PATH) {
    const token = url.searchParams.get("token");
    // An empty `?token=` is not a token. Treating it as one would send an
    // obviously-doomed request and answer with the server's "that link is
    // incomplete" where "ask for a link" is the useful screen.
    return token ? { kind: "redeem", token } : { kind: "signIn" };
  }

  // `?poll=` so a run can be started anywhere in the graph without a rebuild.
  return { kind: "run", pollId: url.searchParams.get("poll") || FIRST_POLL_ID };
}

/** The URL a route should show. The inverse of `routeFrom` for every route. */
export function pathOf(route: Route): string {
  switch (route.kind) {
    case "signIn":
      return SIGN_IN_PATH;
    case "redeem":
      return `${SIGN_IN_PATH}?token=${encodeURIComponent(route.token)}`;
    case "run":
      // The default start is the bare path, so the common URL stays clean and
      // shareable rather than carrying a parameter that changes nothing.
      return route.pollId === FIRST_POLL_ID
        ? "/"
        : `/?poll=${encodeURIComponent(route.pollId)}`;
  }
}
