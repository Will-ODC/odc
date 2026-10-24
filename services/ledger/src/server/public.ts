import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { ZERO_HASH } from "../chain/index.js";
import { exportLines, head, readSince } from "../db/events.js";
import { canonicalInt, createApp, type ServerLogger } from "./http.js";

/** RA-6: the default and the maximum page size. */
export const MAX_LIMIT = 1000;

export interface PublicDeps {
  /** Read-only use: SELECT on `events`. */
  pool: Pool;
  logger?: ServerLogger;
}

/**
 * The public port: `contracts/read-api.md` (RA-1..RA-13), `GET /head` and
 * `GET /export`. Unauthenticated and read-only; every byte it serves is
 * already in the export. Nothing here is keyed by a ballot's submitter
 * (ET-21a).
 */
export function buildPublicApp(deps: PublicDeps): FastifyInstance {
  const { pool } = deps;
  // No route takes a body.
  const app = createApp(deps.logger, 1024);

  app.get("/events", async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const since = query.since === undefined ? 0 : canonicalInt(query.since);
    if (since === null) return reply.code(400).send({ error: "bad_since" });
    const limit =
      query.limit === undefined ? MAX_LIMIT : canonicalInt(query.limit);
    if (limit === null || limit === 0) {
      return reply.code(400).send({ error: "bad_limit" });
    }
    const pageSize = Math.min(limit, MAX_LIMIT);
    // One extra row says whether a later event exists, from the same read.
    const rows = await readSince(pool, since, pageSize + 1);
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    let next: number | null = null;
    let headHash: string;
    if (rows.length > pageSize && last !== undefined) {
      next = last.seq;
      headHash = (await head(pool))?.hash ?? ZERO_HASH;
    } else if (last !== undefined) {
      // Nothing beyond this page in that read: its last event was the head.
      headHash = last.hash;
    } else {
      headHash = (await head(pool))?.hash ?? ZERO_HASH;
    }
    // RA-7: each event is its stored canonical line, byte for byte, never a
    // re-serialized object.
    const body =
      `{"events":[${page.map((r) => r.line).join(",")}],` +
      `"next":${next === null ? "null" : String(next)},"head":"${headHash}"}`;
    return reply.type("application/json").send(body);
  });

  // RA-13: the read API takes no writes.
  app.route({
    method: ["POST", "PUT", "DELETE", "PATCH"],
    url: "/events",
    handler: (_req, reply) =>
      reply
        .code(405)
        .header("allow", "GET, HEAD")
        .send({ error: "method_not_allowed" }),
  });

  app.get("/head", async () => {
    const h = await head(pool);
    return h === null ? { seq: 0, hash: ZERO_HASH } : h;
  });

  // EX-1..EX-6: the stored lines, LF-terminated, from one snapshot. An empty
  // log streams zero bytes. The snapshot is opened and its first batch read
  // before the 200 is sent, so a failure there is an error response, never
  // a truncated body that would look like a valid prefix.
  app.get("/export", async (_req, reply) => {
    const lines = exportLines(pool);
    const first = await lines.next();
    async function* all(): AsyncGenerator<string> {
      if (first.done === true) return;
      yield first.value;
      yield* lines;
    }
    return reply
      .type("application/x-ndjson")
      .send(Readable.from(all(), { objectMode: false }));
  });

  return app;
}
