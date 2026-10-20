import type { Draft } from "./new-poll.js";
import { LIMITS } from "./new-poll.js";
import type { ReturnStore } from "./sign-in-return.js";

/**
 * A posting-form draft kept across a sign-in (#393 review).
 *
 * When a session ends just as someone posts, the server answers 401 and the
 * form sends them to sign in. The emailed link opens a new tab, so the draft
 * goes in `localStorage`, not `sessionStorage`, and comes back on the form.
 * It holds only what the person typed for a public question. It is read
 * once, ignored after an hour like the sign-in return, and checked field by
 * field: anything this file did not write is dropped, never half-used.
 *
 * The purpose promise is never kept: on a shared device the next person to
 * sign in must make it themselves, or Post would record it for their account.
 * Who sees a kept draft is decided by the callers: only the way back from a
 * sign-in started on the form restores it, and signing out forgets it.
 */
const KEY = "pulse.newPollDraft";
export const DRAFT_LIFETIME_MS = 60 * 60 * 1000;

export function keepDraft(
  draft: Draft,
  store: ReturnStore | null,
  now: number = Date.now(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(
      KEY,
      JSON.stringify({ draft: { ...draft, promised: false }, at: now }),
    );
    return true;
  } catch {
    // Storage refused: the form says nothing was kept.
    return false;
  }
}

/** The kept draft, if one is still good. Leaves it in place. */
export function readDraft(
  store: ReturnStore | null,
  now: number = Date.now(),
): Draft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const kept: unknown = JSON.parse(raw);
    if (typeof kept !== "object" || kept === null) return null;
    const { draft, at } = kept as { draft?: unknown; at?: unknown };
    if (typeof at !== "number" || now - at > DRAFT_LIFETIME_MS || at > now)
      return null;
    return isDraft(draft) ? { ...draft, promised: false } : null;
  } catch {
    return null;
  }
}

export function forgetDraft(store: ReturnStore | null): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Nothing to do: an unreadable draft is ignored anyway.
  }
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  const closing = d.closing as Record<string, unknown> | null | undefined;
  const attribution = d.attribution as
    Record<string, unknown> | null | undefined;
  return (
    typeof d.question === "string" &&
    Array.isArray(d.choices) &&
    d.choices.length >= LIMITS.minChoices &&
    d.choices.length <= LIMITS.maxChoices &&
    d.choices.every((one) => typeof one === "string") &&
    (d.method === "single" || d.method === "approval") &&
    typeof closing === "object" &&
    closing !== null &&
    (closing.kind === "default" ||
      (closing.kind === "chosen" && typeof closing.local === "string")) &&
    typeof attribution === "object" &&
    attribution !== null &&
    (attribution.kind === "anonymous" || attribution.kind === "named") &&
    typeof attribution.name === "string" &&
    typeof d.promised === "boolean"
  );
}
