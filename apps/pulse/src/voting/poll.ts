/**
 * How a poll is answered. Mirrors `PollMethod` in the client
 * (`apps/pulse-web/src/api/types.ts`); the two must stay in step. `single` is
 * one choice; `approval` is any number of them. A ballot is an array either
 * way — the method decides how many entries are allowed, not the shape.
 */
export type PollMethod = "single" | "approval";

const METHODS: readonly PollMethod[] = ["single", "approval"];

/** A question with a fixed set of choices. Choices are ordered and stable. */
export interface Poll {
  id: string;
  question: string;
  /** Display order is array order; a vote records the index, never the text. */
  choices: readonly string[];
  method: PollMethod;
  /**
   * The poll each choice opens next, position for position with `choices`, and
   * `null` where that choice ends the run.
   *
   * This is what makes pulse a graph rather than a list: answering is also
   * navigating, and where you go next is a property of the answer you gave.
   * Always the same length as `choices`, so a choice can never silently lose
   * its onward link when one is added.
   */
  next: readonly (string | null)[];
  createdAt: Date;
  /** When set and in the past, the poll no longer accepts votes. */
  closesAt?: Date;
  /** Whether people may add options of their own. */
  acceptsSuggestions: boolean;
}

export interface NewPoll {
  id: string;
  question: string;
  choices: readonly string[];
  method: PollMethod;
  /** Defaults to no onward link from any choice. */
  next?: readonly (string | null)[];
  closesAt?: Date;
  /** Defaults to false: a poll takes suggestions only if it says so. */
  acceptsSuggestions?: boolean;
}

export const MIN_CHOICES = 2;
/**
 * Generous on purpose — a poll can list every option a community actually
 * proposed. The limit is only here to keep one screen scrollable and to stop
 * an accidental thousand-row paste; raise it if a real poll needs more.
 */
export const MAX_CHOICES = 25;

/**
 * Build a poll, rejecting shapes the UI could not render or a voter could not
 * answer meaningfully. Storage-agnostic on purpose: the same rules apply
 * whether the poll came from a seed script or a create form.
 */
export function createPoll(input: NewPoll, now: Date = new Date()): Poll {
  const question = input.question.trim();
  if (input.id.trim() === "") throw new TypeError("poll id must not be empty");
  if (question === "") throw new TypeError("poll question must not be empty");

  // Required, no default: a poll that does not say how it is answered is a
  // programming mistake, not a shape to guess a fallback for.
  if (!METHODS.includes(input.method)) {
    throw new TypeError(`poll method must be one of: ${METHODS.join(", ")}`);
  }

  if (input.choices.length < MIN_CHOICES) {
    throw new TypeError(`a poll needs at least ${MIN_CHOICES} choices`);
  }
  if (input.choices.length > MAX_CHOICES) {
    throw new TypeError(`a poll may have at most ${MAX_CHOICES} choices`);
  }

  const choices = input.choices.map((c) => c.trim());
  if (choices.some((c) => c === ""))
    throw new TypeError("a choice must not be empty");
  if (new Set(choices).size !== choices.length) {
    throw new TypeError("choices must be distinct");
  }

  const next = input.next ?? choices.map(() => null);
  if (next.length !== choices.length) {
    throw new TypeError(
      "next must name one onward poll per choice, or be left out entirely",
    );
  }

  const poll: Poll = {
    id: input.id,
    question,
    choices,
    method: input.method,
    next: [...next],
    createdAt: now,
    acceptsSuggestions: input.acceptsSuggestions ?? false,
  };
  return input.closesAt ? { ...poll, closesAt: input.closesAt } : poll;
}

export function isOpen(poll: Poll, now: Date = new Date()): boolean {
  return poll.closesAt === undefined || poll.closesAt.getTime() > now.getTime();
}
