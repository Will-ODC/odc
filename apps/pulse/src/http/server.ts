import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { ClaimService } from "../identity/claim.js";
import type { Voter, VoterStore } from "../identity/store.js";
import { isOpen, type Poll } from "../voting/poll.js";
import {
  BallotError,
  UnknownPollError,
  type VotingStore,
} from "../voting/store.js";
import { SESSION_COOKIE, SessionSigner } from "./session.js";

export interface ServerDeps {
  claims: ClaimService;
  voters: VoterStore;
  votes: VotingStore;
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
  const now = deps.clock ?? (() => new Date());

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
        // No number in the sentence: the window is configurable (an hour by
        // default for sign-in), so naming a minute would be wrong sixty times
        // over for the limit it most often guards.
        message: "Too many tries just now. Try again a little later.",
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

  /** The signed-in voter, or undefined. Used where signing in is optional. */
  const currentVoter = async (
    request: FastifyRequest,
  ): Promise<Voter | undefined> => {
    const claims = deps.signer.verify(request.cookies[SESSION_COOKIE]);
    if (!claims) return undefined;

    const voter = await deps.voters.byId(claims.voterId);
    if (!voter) return undefined;
    // Sessions issued before the voter last signed out are dead, wherever the
    // cookie is held. This is what makes signing out more than a request to
    // the browser that clicked it.
    if (voter.sessionsValidFrom && claims.issuedAt < voter.sessionsValidFrom) {
      return undefined;
    }
    return voter;
  };

  /** The signed-in voter, or undefined once a 401 has been sent. */
  const requireVoter = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Voter | undefined> => {
    const voter = await currentVoter(request);
    if (!voter) {
      // A cookie that expired, was signed under a rotated secret, was issued
      // before a sign-out, or names a voter who no longer exists is not an
      // error to explain — it just means signed out.
      await reply
        .code(401)
        .send({ error: "signed_out", message: "Sign in to do that." });
      return undefined;
    }
    return voter;
  };

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

  /**
   * Sign out everywhere, not only here: the voter's sessions-valid-from moves
   * to now, so a copy of the cookie someone else kept stops working too.
   */
  app.post("/api/sign-out", async (request, reply) => {
    const voter = await currentVoter(request);
    if (voter) await deps.voters.invalidateSessionsBefore(voter.id, now());
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ status: "signed_out" });
  });

  app.get("/api/me", async (request, reply) => {
    const voter = await requireVoter(request, reply);
    if (!voter) return reply;
    return reply.send({ voter: publicVoter(voter) });
  });

  // Reading a poll or its results needs no session: a signed-in story viewer
  // reads both while moving through the story, and neither reveals anything
  // about a person. Only the two routes that are *about* the signed-in voter —
  // their own ballot, and casting one — require a session.
  app.get("/api/polls/:id", async (request, reply) => {
    const poll = await deps.votes.getPoll(pollId(request));
    if (!poll) return notFoundPoll(reply);
    return reply.send(pollBody(poll, now()));
  });

  app.get("/api/polls/:id/results", async (request, reply) => {
    const poll = await deps.votes.getPoll(pollId(request));
    if (!poll) return notFoundPoll(reply);
    return reply.send(await deps.votes.results(poll.id));
  });

  app.get("/api/polls/:id/ballot", async (request, reply) => {
    const voter = await requireVoter(request, reply);
    if (!voter) return reply;
    const poll = await deps.votes.getPoll(pollId(request));
    if (!poll) return notFoundPoll(reply);
    const vote = await deps.votes.voteOf(poll.id, voter.id);
    return reply.send({ ballot: vote ? vote.choices : null });
  });

  app.post("/api/polls/:id/votes", async (request, reply) => {
    const voter = await requireVoter(request, reply);
    if (!voter) return reply;

    const ballot = (request.body as { ballot?: unknown } | undefined)?.ballot;
    // Shape first: the body must carry a list of whole numbers. Whether those
    // numbers are a *valid* answer to this poll is the store's call, below.
    if (!Array.isArray(ballot) || !ballot.every((n) => Number.isInteger(n))) {
      return reply.code(400).send({
        error: "bad_request",
        message: "A ballot is a list of the choices you picked.",
      });
    }

    try {
      const outcome = await deps.votes.castVote(
        pollId(request),
        voter.id,
        ballot as number[],
      );
      if (outcome.status === "closed") {
        return reply.send({ status: "closed" });
      }
      // counted | changed — hand back the stored ballot and the fresh tally so
      // the client can show the result without a second round trip.
      const results = await deps.votes.results(pollId(request));
      return reply.send({
        status: outcome.status,
        ballot: outcome.vote.choices,
        results,
      });
    } catch (error) {
      if (error instanceof UnknownPollError) return notFoundPoll(reply);
      if (error instanceof BallotError) {
        return reply
          .code(400)
          .send({ error: "bad_ballot", message: error.message });
      }
      throw error;
    }
  });

  return app;
}

/** The `:id` path parameter, decoded by Fastify already. */
function pollId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function notFoundPoll(reply: FastifyReply) {
  return reply
    .code(404)
    .send({ error: "not_found", message: "There is no such poll." });
}

/** A poll in the client's wire shape: dates as ISO strings, openness resolved. */
function pollBody(poll: Poll, now: Date) {
  return {
    id: poll.id,
    question: poll.question,
    choices: [...poll.choices],
    method: poll.method,
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    open: isOpen(poll, now),
  };
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
