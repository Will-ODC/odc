export const REFERENCE_CHOICES = ["Garden", "Housing", "Playground"] as const;
export type ReferenceChoice = (typeof REFERENCE_CHOICES)[number];
export type Stance = "support" | "oppose" | "mixed" | "uncertain";

export interface SampleComment {
  id: string;
  author: string;
  text: string;
  stance: Partial<Record<ReferenceChoice, Stance>>;
  hidden?: boolean;
}

/** Deliberately small, invented examples. Stances are assigned by this sample,
 * never inferred from a reader's ballot or a real author's writing. */
export const SAMPLE_COMMENTS: readonly SampleComment[] = [
  {
    id: "1",
    author: "Ari",
    text: "A garden would give neighbours a place to grow food.",
    stance: { Garden: "support", Housing: "oppose" },
  },
  {
    id: "2",
    author: "Bo",
    text: "Homes are the urgent need on this block.",
    stance: { Garden: "oppose", Housing: "support" },
  },
  {
    id: "3",
    author: "Cleo",
    text: "Children need a safe place to play nearby.",
    stance: { Garden: "oppose", Playground: "support" },
  },
  {
    id: "4",
    author: "Dev",
    text: "I like a garden, but I worry about who would maintain it.",
    stance: { Garden: "mixed" },
  },
  {
    id: "5",
    author: "Eli",
    text: "Could the site fit garden beds and a small play area?",
    stance: { Garden: "support", Playground: "support" },
  },
  {
    id: "6",
    author: "Fran",
    text: "I need more information about soil safety first.",
    stance: {
      Garden: "uncertain",
      Housing: "uncertain",
      Playground: "uncertain",
    },
  },
  {
    id: "7",
    author: "Gus",
    text: "The garden could be shared with the school.",
    stance: { Garden: "support" },
  },
  {
    id: "8",
    author: "Hana",
    text: "Housing could include a public courtyard.",
    stance: { Housing: "support" },
  },
  {
    id: "9",
    author: "Hidden example",
    text: "This sample is excluded by moderation.",
    stance: { Garden: "oppose" },
    hidden: true,
  },
];

export function visibleComments(comments: readonly SampleComment[]) {
  return comments.filter((comment) => !comment.hidden);
}

export function commentsWithStance(
  comments: readonly SampleComment[],
  reference: ReferenceChoice,
  stance: "support" | "oppose",
) {
  return visibleComments(comments).filter(
    (comment) => comment.stance[reference] === stance,
  );
}

/** A distinct random slice on each press when enough samples exist. */
export function randomSample(
  comments: readonly SampleComment[],
  previous: readonly string[] = [],
  random: () => number = Math.random,
): SampleComment[] {
  const pool = visibleComments(comments);
  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  const sample = pool.slice(0, 3);
  if (
    pool.length > 3 &&
    sample.map((one) => one.id).join() === previous.join()
  ) {
    return pool.slice(1, 4);
  }
  return sample;
}
