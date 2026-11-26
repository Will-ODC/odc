import type { Poll } from "../api/types.js";
import type { CastState } from "../hooks/use-cast-vote.js";
import type { VoteCardStatus } from "../components/VoteCard.js";

/** Every current method gives each choice value 1: ADR-0021's tie goes to the lowest index. */
export function nextFor(poll: Poll, ballot: readonly number[]): string | null {
  const chosen = ballot.filter(
    (index) =>
      Number.isInteger(index) && index >= 0 && index < poll.choices.length,
  );
  return chosen.length === 0 ? null : (poll.next[Math.min(...chosen)] ?? null);
}

export function cardStatus(poll: Poll, state: CastState): VoteCardStatus {
  if (!poll.open || state.status === "closed") return { kind: "closed" };
  switch (state.status) {
    case "casting":
      return { kind: "sending" };
    case "failed":
      return { kind: "failed", message: state.message };
    case "counted":
      return {
        kind: "answered",
        results: state.results,
        changed: state.changed,
      };
    default:
      return { kind: "answerable" };
  }
}

export function closingNote(poll: Poll, canChange = true): string {
  if (!poll.open) return "This question has closed.";
  const date = poll.closesAt === null ? null : new Date(poll.closesAt);
  if (!date || Number.isNaN(date.getTime()))
    return canChange
      ? "You can change your answer while this question is open."
      : "";
  const closes = `Closes ${readableDate(date)}`;
  return canChange
    ? `${closes} · you can change your answer until then.`
    : `${closes}.`;
}

/** A calendar date in the same short style used by the poll page. */
export function readableDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
