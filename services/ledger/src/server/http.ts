import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { MAX_INT } from "../chain/index.js";

/**
 * What both ports share: a Fastify instance whose every error body is
 * `{ "error": "<code>" }` (API.md), and the ES-5 integer parser.
 *
 * Request bodies are never logged: Fastify's default request serializer logs
 * method, URL and peer only, and nothing here adds more.
 */
export type ServerLogger = FastifyServerOptions["logger"];

const CANONICAL_INT = /^(0|[1-9][0-9]*)$/;

/**
 * An ES-5 canonical non-negative integer (no sign, no leading zero, no
 * fraction or exponent, at most 2^53 - 1), or null. Anything that is not a
 * single string, such as a repeated query parameter, is not one.
 */
export function canonicalInt(raw: unknown): number | null {
  if (typeof raw !== "string" || !CANONICAL_INT.test(raw)) return null;
  // Longer than MAX_INT's 16 digits is out of range; Number() would round it.
  if (raw.length > 16) return null;
  const n = Number(raw);
  return n <= MAX_INT ? n : null;
}

function clientErrorCode(status: number): string {
  if (status === 413) return "payload_too_large";
  if (status === 415) return "unsupported_media_type";
  return "bad_request";
}

export function createApp(
  logger: ServerLogger,
  bodyLimit: number,
): FastifyInstance {
  const app = Fastify({ logger: logger ?? false, bodyLimit });
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: "not_found" });
  });
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      void reply.code(status).send({ error: clientErrorCode(status) });
      return;
    }
    req.log.error({ err }, "request failed");
    void reply.code(500).send({ error: "internal" });
  });
  return app;
}
