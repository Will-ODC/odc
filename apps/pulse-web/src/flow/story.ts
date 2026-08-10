import type { Ballot, Poll, PollMethod } from "../api/types.js";

/**
 * The story's shape and the rules for moving through it. Pure on purpose: the
 * screens render what these functions decide, so the sequencing and the ballot
 * rules can be tested without a browser.
 */

export interface Bite {
  /** Short line over the media. */
  caption: string;
  headline: string;
  body: string;
  /** Optional pair of big numbers under the text. */
  stats?: { value: string; label: string }[];
  /** Picks the media treatment until real media exists. */
  tone?: "teal" | "violet";
}

export interface Story {
  id: string;
  community: string;
  communityLabel: string;
  bites: Bite[];
  pollId: string;
  /** What happens after the vote, stated as a promise the product must keep. */
  promise: { headline: string; body: string };
  contributions: { icon: string; title: string; detail: string }[];
}

export type Step =
  | { name: "claim" }
  | { name: "sent" }
  | { name: "bite"; index: number }
  | { name: "vote" }
  | { name: "results" }
  | { name: "action" };

/** Step order, given how many bites this story has. */
export function steps(story: Story): Step[] {
  return [
    { name: "claim" },
    { name: "sent" },
    ...story.bites.map((_, index) => ({ name: "bite" as const, index })),
    { name: "vote" },
    { name: "results" },
    { name: "action" },
  ];
}

export function nextStep(story: Story, current: Step): Step | undefined {
  const all = steps(story);
  const at = all.findIndex((s) => sameStep(s, current));
  return at === -1 ? undefined : all[at + 1];
}

export function previousStep(story: Story, current: Step): Step | undefined {
  const all = steps(story);
  const at = all.findIndex((s) => sameStep(s, current));
  // Never walk back into the sign-in panes from inside the story: the person is
  // already signed in by then, and "back" should feel like the story, not a form.
  if (at <= 2) return undefined;
  return all[at - 1];
}

export function sameStep(a: Step, b: Step): boolean {
  if (a.name !== b.name) return false;
  return a.name === "bite" && b.name === "bite" ? a.index === b.index : true;
}

/** Progress dots cover the bites plus the vote — the parts you move through. */
export function progress(
  story: Story,
  current: Step,
): { total: number; done: number } {
  const total = story.bites.length + 1;
  if (current.name === "bite") return { total, done: current.index + 1 };
  if (current.name === "vote") return { total, done: total };
  return { total, done: 0 };
}

/**
 * Toggle a choice, honouring the poll's method: `single` replaces the selection,
 * `approval` adds or removes one. Kept here, not in the component, because it is
 * the rule that decides what a ballot means.
 */
export function toggleChoice(
  method: PollMethod,
  ballot: Ballot,
  choice: number,
): Ballot {
  if (method === "single") return ballot[0] === choice ? [] : [choice];
  return ballot.includes(choice)
    ? ballot.filter((c) => c !== choice)
    : [...ballot, choice].sort((a, b) => a - b);
}

export function isCastable(
  poll: Poll,
  ballot: Ballot,
  existing: Ballot | null,
): boolean {
  if (!poll.open || ballot.length === 0) return false;
  // Re-casting the same ballot is a no-op; the button should say so by being off.
  return existing === null || !sameBallot(ballot, existing);
}

export function sameBallot(a: Ballot, b: Ballot): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The button's label, which is also the clearest statement of what will happen. */
export function castLabel(
  poll: Poll,
  ballot: Ballot,
  existing: Ballot | null,
): string {
  if (!poll.open) return "Voting has closed";
  if (ballot.length === 0) {
    return poll.method === "approval"
      ? "Choose at least one"
      : "Choose an option";
  }
  if (existing && sameBallot(ballot, existing))
    return "This is already your vote";
  if (existing) return "Change my vote";
  return poll.method === "approval"
    ? `Cast my vote (${ballot.length})`
    : "Cast my vote";
}
