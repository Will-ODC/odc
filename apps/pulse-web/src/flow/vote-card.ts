import type { PollMethod } from "../api/types.js";

/** Selection and validation use choice indexes, never their display positions. */
export function pickChoice(
  method: PollMethod,
  picked: readonly number[],
  index: number,
): number[] {
  if (method === "single") return [index];
  return picked.includes(index)
    ? picked.filter((one) => one !== index)
    : [...picked, index];
}

export function validCardBallot(
  method: PollMethod,
  choices: readonly { index: number }[],
  picked: readonly number[],
): boolean {
  return (
    picked.length > 0 &&
    (method !== "single" || picked.length === 1) &&
    new Set(picked).size === picked.length &&
    picked.every(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        choices.some((one) => one.index === index),
    )
  );
}

/** Number shortcuts address the numbered rows, even when indexes are reordered. */
export function numberedChoice(
  key: string,
  choices: readonly { index: number }[],
): number | undefined {
  return /^[1-9]$/.test(key) ? choices[Number(key) - 1]?.index : undefined;
}

/**
 * Whether the vote on the card is confirmed by email, as far as this page
 * knows (#353, ADR-0040).
 *
 * `confirmed`: someone is signed in on this browser, so the server confirmed
 * the vote, at the cast or at sign-in. `offer`: nobody is, and signing in
 * would confirm it. `unknown`: the page has not heard yet, so it says neither
 * rather than offer a sign-in that turns out to be unnecessary a moment later.
 */
export type Confirmation = "confirmed" | "offer" | "unknown";

/**
 * What the card says about a vote it has counted.
 *
 * "Counted", and "confirmed by email" once someone is signed in. Never
 * "verified": an email address is not a person, so confirming one proves
 * somebody can read that mail, not that a vote is one human's only vote.
 */
export function countedNote(
  changed: boolean,
  confirmation: Confirmation,
): string {
  const status =
    confirmation === "confirmed" ? "Counted · confirmed by email" : "Counted";
  return changed ? `${status}. That replaces your earlier answer.` : status;
}
