import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ConfirmationKey } from "./confirmation.js";
import type { PublicVoteEntry } from "./store.js";

/**
 * A public-vote poll's list (ADR-0048 decision 7): the query a page is asked
 * with, the sealed cursor that carries the store's list key between pages,
 * and the one projection a page is served as.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const LIST_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sealedShape = z
  .object({ v: z.literal(1), p: z.string(), k: z.string().regex(LIST_KEY) })
  .strict();

/** `limit` 1–50 (default 20) and an optional cursor, still sealed. */
export function parsePublicVotesQuery(
  raw: unknown,
): { limit: number; cursor?: string } | undefined {
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
  return query.data.cursor ? { limit, cursor: query.data.cursor } : { limit };
}

/**
 * Seals and opens list cursors: AES-256-GCM over `{pollId, listKey}` with a
 * fresh random 96-bit nonce, so the same position never gives the same
 * cursor twice and a client can neither read nor forge one. The key comes
 * from the confirmation key under its own label, so rotating that key ends
 * every outstanding cursor (they answer 400; the first page still works).
 */
export class PublicVotesCursor {
  readonly #key: Buffer;

  constructor(confirmationKey: ConfirmationKey) {
    this.#key = confirmationKey.cursorKey();
  }

  seal(pollId: string, listKey: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    const body = Buffer.concat([
      cipher.update(JSON.stringify({ v: 1, p: pollId, k: listKey }), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString(
      "base64url",
    );
  }

  /** The list key, or undefined for a cursor that fails or names another poll. */
  open(pollId: string, cursor: string): string | undefined {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) return undefined;
    if (bytes.length <= NONCE_BYTES + TAG_BYTES) return undefined;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        bytes.subarray(0, NONCE_BYTES),
      );
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
      const sealed = sealedShape.parse(JSON.parse(plain));
      return sealed.p === pollId ? sealed.k : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * The one projection of a page: each entry's name and choices and nothing
 * else. The list key leaves only inside the sealed cursor.
 */
export function publicVotesPage(
  pollId: string,
  entries: PublicVoteEntry[],
  limit: number,
  cursor: PublicVotesCursor,
) {
  const shown = entries.slice(0, limit);
  const last = shown.at(-1);
  return {
    items: shown.map((entry) => ({
      name: entry.name,
      choices: [...entry.choices],
    })),
    nextCursor:
      entries.length > limit && last ? cursor.seal(pollId, last.listKey) : null,
  };
}
