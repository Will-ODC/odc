import { randomUUID } from "node:crypto";
import type { Poll } from "./poll.js";

/**
 * Options people add themselves.
 *
 * A suggestion is not a choice on the ballot. Choices are addressed by their
 * position, and a vote records that position — so adding to `Poll.choices`
 * while people are voting would silently change what earlier ballots meant.
 * Suggestions therefore live beside the poll, are counted on their own, and
 * become choices only when someone decides to open a new poll on them.
 *
 * The one thing this module has to get right is that two people saying the
 * same thing in different words are counted as agreeing, and told so — and
 * that includes agreeing with the poll: a suggestion that repeats one of the
 * poll's own choices is turned away with a pointer to that choice, because the
 * choice can be voted for and a suggestion cannot.
 */
export interface Suggestion {
  id: string;
  pollId: string;
  /** The first wording submitted. Later matching wordings do not replace it. */
  text: string;
  /** How many people have now said something like it. */
  count: number;
  addedAt: Date;
}

/** Long enough for a real proposal, short enough to read on one screen. */
export const MAX_SUGGESTION_LENGTH = 120;

/**
 * Words carried by almost every phrasing, which say nothing about what is being
 * proposed. Dropping them is what lets "we could charge members" and "charge
 * the members" land on each other.
 */
const NOISE = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
  "we",
  "us",
  "our",
  "you",
  "your",
  "do",
  "does",
  "did",
  "it",
  "is",
  "are",
  "be",
  "been",
  "and",
  "or",
  "but",
  "on",
  "in",
  "by",
  "with",
  "from",
  "at",
  "as",
  "that",
  "this",
  "these",
  "those",
  "should",
  "could",
  "would",
  "can",
  "will",
  "just",
  "some",
  "any",
  "how",
  "what",
  "make",
  "let",
  "put",
  "get",
]);

/** Two phrasings this close are treated as the same idea. */
export const SAME_IDEA = 0.6;

/** Close enough to be worth showing, but not close enough to merge into. */
export const RELATED = 0.3;

/**
 * The words a phrase is actually about: lowercased, stripped of punctuation,
 * de-noised, and de-duplicated.
 */
export function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "" && !NOISE.has(word));
  return new Set(words);
}

/**
 * How much two phrases overlap, 0 to 1 — the share of all the words they use
 * between them that they use in common.
 *
 * Two phrases made only of noise words have nothing to compare, and are called
 * unrelated rather than identical: "should we do it" and "can you get that"
 * are not the same proposal, and treating every empty phrase as a match would
 * merge them all into the first one submitted.
 */
export function overlap(a: string, b: string): number {
  const left = keywords(a);
  const right = keywords(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Thrown when a suggestion is not something a person could have meant. */
export class SuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionError";
  }
}

/** A choice the poll already lists, named so a person can go and pick it. */
export interface BallotChoice {
  /** Position in `Poll.choices`. What a vote records. */
  index: number;
  /** The choice as the poll words it. */
  label: string;
}

export type SubmitResult =
  /** Nobody had said this. It is now on the list. */
  | { status: "added"; suggestion: Suggestion; related: Suggestion[] }
  /** Someone had already said it; their wording keeps the floor. */
  | { status: "seconded"; suggestion: Suggestion; related: Suggestion[] }
  /**
   * The poll already offers this, so nothing was added. The person is pointed
   * at the choice instead: it is votable, and a suggestion saying the same
   * thing would not be.
   */
  | { status: "on_ballot"; choice: BallotChoice; related: Suggestion[] };

export interface SuggestionStore {
  /**
   * Takes the whole poll, not just its id, because a suggestion that repeats
   * one of the poll's own choices is the commonest duplicate of all — the
   * choices are on the screen directly above the field.
   */
  submit(poll: Poll, text: string): Promise<SubmitResult>;
  /** Most-said first. */
  list(pollId: string): Promise<Suggestion[]>;
}

export class InMemorySuggestionStore implements SuggestionStore {
  readonly #byPoll = new Map<string, Suggestion[]>();
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(options: { clock?: () => Date; newId?: () => string } = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? (() => randomUUID());
  }

  async submit(poll: Poll, text: string): Promise<SubmitResult> {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (trimmed === "") {
      throw new SuggestionError("Write what you would rather see.");
    }
    if (trimmed.length > MAX_SUGGESTION_LENGTH) {
      throw new SuggestionError(
        `Keep it under ${MAX_SUGGESTION_LENGTH} characters.`,
      );
    }
    if (keywords(trimmed).size === 0) {
      throw new SuggestionError("Say a little more about what you mean.");
    }

    const existing = this.#byPoll.get(poll.id) ?? [];
    const scored = existing
      .map((suggestion) => ({
        suggestion,
        score: overlap(trimmed, suggestion.text),
      }))
      .sort((a, b) => b.score - a.score);

    // The poll's own choices come first. Saying what the ballot already offers
    // is not a new idea to be counted beside the poll; it is a vote the person
    // has not cast yet, and the only useful answer is to say so. Suggestions
    // are never appended to `Poll.choices` — see the note at the top of this
    // file — so a duplicate left standing would be an option nobody can vote
    // for, sitting under one they can.
    const onBallot = poll.choices
      .map((label, index) => ({ index, label, score: overlap(trimmed, label) }))
      .sort((a, b) => b.score - a.score)[0];
    if (onBallot && onBallot.score >= SAME_IDEA) {
      return {
        status: "on_ballot",
        choice: { index: onBallot.index, label: onBallot.label },
        related: nearby(scored),
      };
    }

    const best = scored[0];
    if (best && best.score >= SAME_IDEA) {
      best.suggestion.count += 1;
      return {
        status: "seconded",
        suggestion: best.suggestion,
        related: nearby(scored.slice(1)),
      };
    }

    const suggestion: Suggestion = {
      id: this.#newId(),
      pollId: poll.id,
      text: trimmed,
      count: 1,
      addedAt: this.#clock(),
    };
    this.#byPoll.set(poll.id, [...existing, suggestion]);
    return { status: "added", suggestion, related: nearby(scored) };
  }

  async list(pollId: string): Promise<Suggestion[]> {
    return [...(this.#byPoll.get(pollId) ?? [])].sort(
      (a, b) => b.count - a.count || a.addedAt.getTime() - b.addedAt.getTime(),
    );
  }
}

/** The ones close enough to be worth showing, most-said first. */
function nearby(
  scored: { suggestion: Suggestion; score: number }[],
): Suggestion[] {
  return scored
    .filter((entry) => entry.score >= RELATED)
    .map((entry) => entry.suggestion)
    .sort((a, b) => b.count - a.count);
}
