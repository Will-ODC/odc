/**
 * Which question to come back to after signing in (#353).
 *
 * "Confirm with your email" on a vote card opens `/sign-in?poll=<id>`. The
 * emailed link that follows is `/sign-in?token=…` and carries no poll: the
 * server builds it, and nothing in the request says where to return. So the
 * sign-in screen remembers the poll in this browser, and the redeem screen
 * reads it back - the link is opened in the same browser for the sign-in to
 * mean anything here, since the session cookie lands in that browser.
 *
 * `localStorage`, not `sessionStorage`: the emailed link opens a new tab, which
 * starts with an empty session store. What is kept is a public poll id and a
 * time, nothing about the person. It is forgotten once read, and ignored after
 * an hour - a sign-in link lasts 15 minutes, so anything older belongs to a
 * sign-in that did not happen.
 *
 * Every read and write is guarded: storage can be missing, full or refused
 * (private windows, blocked site data), and then sign-in lands where it
 * always has. Losing the way back is a smaller harm than failing to sign in.
 */

const KEY = "pulse.signInReturn";
/** How long a remembered question is honoured. */
export const RETURN_LIFETIME_MS = 60 * 60 * 1000;
/** Longer than any poll id; anything past it was not written by this file. */
const MAX_ID_LENGTH = 200;

/** The bits of `Storage` this needs, so a test can hand in a plain map. */
export type ReturnStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This browser's `localStorage`, or `null` when the browser will not give it. */
export function browserStore(): ReturnStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Remember `pollId` as where to return, or forget any earlier one when there
 * is none: a sign-in started without a question should not land on the
 * question an older, abandoned sign-in named.
 */
export function rememberReturn(
  pollId: string | undefined,
  store: ReturnStore | null,
  now: number = Date.now(),
): void {
  if (!store) return;
  try {
    if (pollId && pollId.length <= MAX_ID_LENGTH) {
      store.setItem(KEY, JSON.stringify({ pollId, at: now }));
    } else {
      store.removeItem(KEY);
    }
  } catch {
    // Storage refused: sign-in still works, and lands where it always has.
  }
}

/** Read and forget the question to return to, if one is still good. */
export function takeReturn(
  store: ReturnStore | null,
  now: number = Date.now(),
): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    store.removeItem(KEY);
    if (!raw) return null;
    const kept: unknown = JSON.parse(raw);
    if (
      typeof kept !== "object" ||
      kept === null ||
      !("pollId" in kept) ||
      !("at" in kept)
    )
      return null;
    const { pollId, at } = kept;
    if (
      typeof pollId !== "string" ||
      pollId.length === 0 ||
      pollId.length > MAX_ID_LENGTH ||
      typeof at !== "number" ||
      now - at > RETURN_LIFETIME_MS ||
      at > now
    )
      return null;
    return pollId;
  } catch {
    return null;
  }
}

/**
 * Written by the tab that spends an emailed link, so other pulse tabs in this
 * browser hear that someone signed in (#353). A `storage` event reaches every
 * other same-origin tab at once, which a tab switch alone does not: two
 * windows side by side never lose focus to each other. What is written is a
 * time, nothing about the person.
 */
export const SIGNED_IN_KEY = "pulse.signedIn";

export function announceSignIn(
  store: ReturnStore | null,
  now: number = Date.now(),
): void {
  if (!store) return;
  try {
    store.setItem(SIGNED_IN_KEY, String(now));
  } catch {
    // Storage refused: other tabs catch up when they are next looked at.
  }
}
