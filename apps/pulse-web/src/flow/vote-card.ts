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
