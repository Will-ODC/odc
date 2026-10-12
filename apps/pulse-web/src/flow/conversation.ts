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

export function closingNote(poll: Poll): string {
  if (!poll.open) return "This question has closed.";
  if (poll.closesAt === null)
    return "You can change your answer while this question is open.";
  const date = new Date(poll.closesAt);
  return Number.isNaN(date.getTime())
    ? "You can change your answer while this question is open."
    : `Closes ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · you can change your answer until then.`;
}
