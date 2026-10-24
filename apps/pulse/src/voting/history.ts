import { z } from "zod";
import { isOpen, type Poll } from "./poll.js";
import type { Vote, VoteBefore } from "./store.js";

const cursorShape = z
  .object({
    v: z.literal(1),
    at: z.iso.datetime({ precision: 3 }),
    id: z
      .string()
      .min(1)
      .refine((id) => !id.includes("\0")),
  })
  .strict();

export function parseHistoryQuery(
  raw: unknown,
): { limit: number; before?: VoteBefore } | undefined {
  const query = z
    .object({
      limit: z
        .string()
        .regex(/^(?:[1-9]|[1-4][0-9]|50)$/)
        .optional(),
      cursor: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    })
    .strict()
    .safeParse(raw);
  if (!query.success) return undefined;
  const limit = query.data.limit ? Number(query.data.limit) : 20;
  if (!query.data.cursor) return { limit };
  try {
    const bytes = Buffer.from(query.data.cursor, "base64url");
    if (bytes.toString("base64url") !== query.data.cursor) return undefined;
    const cursor = cursorShape.parse(JSON.parse(bytes.toString("utf8")));
    const castAt = new Date(cursor.at);
    if (Number.isNaN(castAt.getTime())) return undefined;
    return { limit, before: { castAt, pollId: cursor.id } };
  } catch {
    return undefined;
  }
}

/** The private projection deliberately excludes voter id and confirmation code. */
export function historyPage(
  votes: Vote[],
  polls: Map<string, Poll>,
  limit: number,
  now: Date,
) {
  const shown = votes.slice(0, limit);
  const last = shown.at(-1);
  return {
    votes: shown.flatMap((vote) => {
      const poll = polls.get(vote.pollId);
      if (!poll) return [];
      return [
        {
          pollId: poll.id,
          question: poll.question,
          choices: vote.choices
            .map((index) => poll.choices[index])
            .filter((s): s is string => s !== undefined),
          castAt: vote.castAt.toISOString(),
          open: isOpen(poll, now),
        },
      ];
    }),
    nextCursor:
      votes.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              at: last.castAt.toISOString(),
              id: last.pollId,
            }),
          ).toString("base64url")
        : null,
  };
}
