import { z } from "zod";
import { isOpen, type PollMethod } from "./poll.js";

/** Only public ordering/display fields; no author or voter data. */
export interface PollSummary {
  id: string;
  question: string;
  method: PollMethod;
  createdAt: Date;
  closesAt?: Date;
}
export interface PollBoundary {
  createdAt: Date;
  id: string;
}
export interface PollListQuery {
  community: string;
  limit: number;
  before?: PollBoundary;
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    community: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !s.includes("\0")),
    at: z.iso.datetime({ precision: 3 }).refine((s) => !s.startsWith("0000")),
    id: z
      .string()
      .min(1)
      .refine((s) => !s.includes("\0")),
  })
  .strict();
const querySchema = z
  .object({
    community: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => s.trim().length > 0 && !s.includes("\0")),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

/** Refuse duplicate parameters and cursors for another community. */
export function parsePollListQuery(raw: unknown): PollListQuery | undefined {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { community, cursor, limit } = parsed.data;
  const query: PollListQuery = {
    community,
    limit: limit === undefined ? 20 : Number(limit),
  };
  if (cursor === undefined) return query;
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) return undefined;
    const data = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    if (data.community !== community) return undefined;
    return { ...query, before: { createdAt: new Date(data.at), id: data.id } };
  } catch {
    return undefined;
  }
}

/** Store returns at most limit + 1 rows; the extra row detects another page. */
export function pollListPage(
  rows: PollSummary[],
  query: PollListQuery,
  now: Date,
) {
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    polls: page.map((p) => ({
      id: p.id,
      question: p.question,
      method: p.method,
      createdAt: p.createdAt.toISOString(),
      closesAt: p.closesAt?.toISOString() ?? null,
      open: isOpen(p, now),
    })),
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              community: query.community,
              at: last.createdAt.toISOString(),
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}

/** PostgreSQL COLLATE "C" ordering, including non-ASCII legacy IDs. */
export function comparePolls(a: PollBoundary, b: PollBoundary): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() ||
    Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))
  );
}
