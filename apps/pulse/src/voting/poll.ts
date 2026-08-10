/** A question with a fixed set of choices. Choices are ordered and stable. */
export interface Poll {
  id: string;
  question: string;
  /** Display order is array order; a vote records the index, never the text. */
  choices: readonly string[];
  createdAt: Date;
  /** When set and in the past, the poll no longer accepts votes. */
  closesAt?: Date;
}

export interface NewPoll {
  id: string;
  question: string;
  choices: readonly string[];
  closesAt?: Date;
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

  const poll: Poll = {
    id: input.id,
    question,
    choices,
    createdAt: now,
  };
  return input.closesAt ? { ...poll, closesAt: input.closesAt } : poll;
}

export function isOpen(poll: Poll, now: Date = new Date()): boolean {
  return poll.closesAt === undefined || poll.closesAt.getTime() > now.getTime();
}
