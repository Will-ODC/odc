import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ClaimService } from "../identity/claim.js";
import type { Voter, VoterStore } from "../identity/store.js";
import { SESSION_COOKIE, SessionSigner } from "./session.js";

export interface ServerDeps {
  claims: ClaimService;
  voters: VoterStore;
  signer: SessionSigner;
  /** Cookies go out secure everywhere except local development. */
  secureCookies?: boolean;
  /** Sign-in attempts allowed per client per window. */
  signInRateLimit?: { max: number; timeWindow: string };
  clock?: () => Date;
}

/**
 * Pulse's HTTP surface. Small on purpose — four things happen in this product:
 * ask for a sign-in link, redeem it, vote, read results.
 *
 * Error bodies are `{ error, message }` where `message` is a plain sentence the
 * UI can show as-is. Nothing here explains how anything is counted.
 */
export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Awaited, not fire-and-forget: a plugin's onRoute hook only sees routes
  // registered after it has loaded, so registering these lazily would leave the
  // rate limit silently switched off.
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // One shape for everything that goes wrong, including failures nobody planned
  // for. Fastify's default 500 body has a different shape and carries the raw
  // error message, which is how internal text ends up on a screen.
  app.setErrorHandler((error, request, reply) => {
    // Plugins and the framework signal ordinary refusals by throwing with a
    // status — the rate limiter's 429, a malformed JSON body's 400. Those are
    // answers, not faults, and must keep their status while taking our shape.
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({
        error: "too_many_requests",
        message: "Too many tries just now. Wait a minute and try again.",
      });
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send({
        error: "bad_request",
        message: "That request could not be read.",
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: "server_error",
      message: "Something went wrong. Try again.",
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: "not_found", message: "There is nothing here." }),
  );

  app.post(
    "/api/sign-in",
    {
      config: {
        rateLimit: deps.signInRateLimit ?? { max: 10, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        email?: unknown;
        wantsProofEmails?: unknown;
      };
      if (typeof body.email !== "string") {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "Enter your email address." });
      }
      // Anything but a boolean is refused rather than read as false. This is
      // the opt-in for proof-of-action email, and getting it wrong silently
      // would be invisible to both sides.
      if (
        body.wantsProofEmails !== undefined &&
        typeof body.wantsProofEmails !== "boolean"
      ) {
        return reply.code(400).send({
          error: "bad_request",
          message: "Say yes or no to updates about what happens next.",
        });
      }

      const result = await deps.claims.requestLink(body.email, {
        wantsProofEmails: body.wantsProofEmails === true,
      });

      switch (result.status) {
        case "sent":
          return reply.send({
            status: "sent",
            message: "Check your email for a link to sign in.",
          });
        case "invalid_email":
          return reply.code(400).send({
            error: "invalid_email",
            message: "That does not look like an email address.",
          });
        case "not_a_member":
          return reply.code(403).send({
            error: "not_a_member",
            message: `${result.domain} is not part of a community on pulse yet.`,
          });
        case "too_many_requests":
          return reply.code(429).send({
            error: "too_many_requests",
            message: "A link is already on its way. Check your email.",
          });
      }
    },
  );

  /**
   * Is this link still good? Answering does NOT consume it.
   *
   * Mail scanners and link prefetchers follow every URL in an email, so a GET
   * that signed you in would be spent before the person ever clicked — and they
   * would then be told the link was already used, indistinguishable from having
   * actually reused it. The click POSTs; this only reports.
   */
  app.get("/api/sign-in/redeem", async (request, reply) => {
    const token = (request.query as { token?: unknown }).token;
    if (typeof token !== "string" || token === "") {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "That link is incomplete." });
    }

    const state = await deps.claims.inspect(token);
    if (state.status !== "live") return gone(reply, state.status);
    return reply.send({ status: "ready", email: state.email });
  });

  /** The click. This is what spends the token and signs someone in. */
  app.post("/api/sign-in/redeem", async (request, reply) => {
    const token = (request.body as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || token === "") {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "That link is incomplete." });
    }

    const result = await deps.claims.redeem(token);
    if (result.status !== "signed_in") return gone(reply, result.status);

    reply.setCookie(SESSION_COOKIE, deps.signer.sign(result.voter.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: deps.secureCookies ?? true,
      path: "/",
      maxAge: deps.signer.ttlSeconds,
    });
    return reply.send({
      status: "signed_in",
      voter: publicVoter(result.voter),
      firstTime: result.firstTime,
    });
  });

  // Signing out, /api/me, and the voting routes are added in the branches
  // stacked on this one.

  return app;
}

/** What a voter is allowed to see about themselves. Never anyone else's. */
function publicVoter(voter: Voter) {
  return { id: voter.id, email: voter.email, community: voter.community };
}

function gone(
  reply: FastifyReply,
  status: "already_used" | "expired" | "unknown_link",
) {
  const message =
    status === "already_used"
      ? "That link has already been used. Ask for a new one."
      : status === "expired"
        ? "That link has expired. Ask for a new one."
        : "That link is not one of ours. Ask for a new one.";
  return reply.code(410).send({ error: status, message });
}
