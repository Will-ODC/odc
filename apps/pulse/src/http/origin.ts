import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * The one `Origin` check every state-changing browser route shares.
 *
 * A request is accepted only when its `Origin` is exactly the configured web
 * origin. `webOrigin` is trusted configuration — never derived from `Host` or
 * a forwarded header. A missing `Origin` is refused like a foreign one, and an
 * absent `webOrigin` refuses everything: there is no origin it could match.
 *
 * Browsers send `Origin` on every POST, same-origin included, so the pulse-web
 * client passes this check without doing anything.
 */
export function originAllowed(
  request: FastifyRequest,
  webOrigin: string | undefined,
): boolean {
  return webOrigin !== undefined && request.headers.origin === webOrigin;
}

/** The refusal, in the `{ error, message }` envelope every route answers with. */
export const ORIGIN_REFUSAL = {
  status: 403,
  error: "origin_not_allowed",
  message: "That request did not come from Pulse.",
} as const;

/**
 * An `onRequest` hook that refuses a request from any other origin before its
 * body is read or anything is looked up, cleared or written.
 */
export function requireWebOrigin(webOrigin: string | undefined) {
  return async function webOriginGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (originAllowed(request, webOrigin)) return;
    await reply.code(ORIGIN_REFUSAL.status).send({
      error: ORIGIN_REFUSAL.error,
      message: ORIGIN_REFUSAL.message,
    });
  };
}
