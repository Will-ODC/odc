/**
 * Which part of pulse a URL points at.
 *
 * Pure on purpose: reading a URL is a decision
 * with edge cases worth testing exhaustively, and none of them need React.
 *
 * There are three places to be, plus one prototype (#228), and the emailed
 * sign-in link is the reason the first two exist.
 * `apps/pulse/src/dev-server.ts` builds that link as
 * `<web origin>/sign-in?token=…`, so the client has to answer that path or the
 * link goes nowhere — which is precisely what it did before this module: the
 * app read `?poll=`, found nothing, and opened the first question as though
 * nobody had clicked anything.
 */
export type Route =
  | { kind: "welcome" }
  | { kind: "progress" }
  | { kind: "questions" }
  | { kind: "browse"; community: string }
  /**
   * Asking for a sign-in link. `returnTo` is where to come back to once the
   * emailed link is clicked: "Confirm with your email" on a vote card names
   * its own question (#353), and the posting form names itself. Left out,
   * sign-in lands where it always has.
   */
  | { kind: "signIn"; returnTo?: ReturnTo }
  /** Arrived from the emailed link, holding a token to spend. */
  | { kind: "redeem"; token: string }
  /**
   * The chat-voting prototype (#228). Sample data, no server calls; reachable
   * only by typing the path, so nobody arrives in it by accident.
   */
  | { kind: "chatPreview" }
  /** "Why you can trust your vote" (#351). Static copy, no server calls. */
  | { kind: "trust" }
  /** Live conversation page; explicit poll links bypass the welcome. */
  | { kind: "conversation"; pollId: string }
  /** Posting a question (ADR-0037). Signed in only; the screen says so. */
  | { kind: "newPoll" };

/** The places a sign-in can return to. */
export type ReturnTo = Extract<Route, { kind: "conversation" | "newPoll" }>;

/**
 * Where a run begins when the URL does not say.
 *
 * Matches `FIRST_POLL_ID` in the dev server's seed. It is a client-side
 * default rather than a fact about the graph: once questions can be authored
 * and browsed, where to start is a server answer, not a constant.
 */
export const FIRST_POLL_ID = "ads-free";

const SIGN_IN_PATH = "/sign-in";
const CHAT_PREVIEW_PATH = "/preview/chat";
export const TRUST_PATH = "/trust";
const NEW_POLL_PATH = "/new";

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
    if (token) return { kind: "redeem", token };
    if (url.searchParams.get("next") === "new")
      return { kind: "signIn", returnTo: { kind: "newPoll" } };
    const pollId = url.searchParams.get("poll");
    return pollId
      ? { kind: "signIn", returnTo: { kind: "conversation", pollId } }
      : { kind: "signIn" };
  }

  if (path === CHAT_PREVIEW_PATH) return { kind: "chatPreview" };
  if (path === TRUST_PATH) return { kind: "trust" };
  if (path === NEW_POLL_PATH) return { kind: "newPoll" };
  if (path === "/start") return { kind: "progress" };
  if (path === "/questions") return { kind: "questions" };
  if (path === "/browse")
    return {
      kind: "browse",
      community: url.searchParams.get("community")?.trim() || "pulse-general",
    };

  if (path === "/" && !url.searchParams.get("poll")) return { kind: "welcome" };

  // `?poll=` so a conversation can be started anywhere in the graph without a rebuild.
  return {
    kind: "conversation",
    pollId: url.searchParams.get("poll") || FIRST_POLL_ID,
  };
}

/** The URL a route should show. The inverse of `routeFrom` for every route. */
export function pathOf(route: Route): string {
  switch (route.kind) {
    case "welcome":
      return "/";
    case "progress":
      return "/start";
    case "questions":
      return "/questions";
    case "browse":
      return `/browse?community=${encodeURIComponent(route.community)}`;
    case "signIn":
      switch (route.returnTo?.kind) {
        case undefined:
          return SIGN_IN_PATH;
        case "newPoll":
          return `${SIGN_IN_PATH}?next=new`;
        case "conversation":
          return `${SIGN_IN_PATH}?poll=${encodeURIComponent(route.returnTo.pollId)}`;
      }
      break;
    case "redeem":
      return `${SIGN_IN_PATH}?token=${encodeURIComponent(route.token)}`;
    case "chatPreview":
      return CHAT_PREVIEW_PATH;
    case "trust":
      return TRUST_PATH;
    case "conversation":
      return `/?poll=${encodeURIComponent(route.pollId)}`;
    case "newPoll":
      return NEW_POLL_PATH;
  }
}
