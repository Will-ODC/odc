import { z } from "zod";
import { isOpen } from "./poll.js";
import type { HistoryVote, VoteBefore } from "./store.js";

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

/**
 * The private projection, which deliberately excludes voter id and
 * confirmation code. A row whose poll was deleted mid-read is left out, so a
 * page may be short, or even empty, and still carry a cursor to the next.
 */
export function historyPage(votes: HistoryVote[], limit: number, now: Date) {
  const shown = votes.slice(0, limit);
  const last = shown.at(-1);
  return {
    votes: shown.flatMap((vote) =>
      vote.poll
        ? [
            {
              pollId: vote.pollId,
              question: vote.poll.question,
              choices: vote.poll.choices,
              ballot: vote.ballot,
              castAt: vote.castAt.toISOString(),
              closesAt: vote.poll.closesAt?.toISOString() ?? null,
              open: isOpen(vote.poll, now),
            },
          ]
        : [],
    ),
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
