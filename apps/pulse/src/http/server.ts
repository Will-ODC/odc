import cookie from "@fastify/cookie";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { ClaimService } from "../identity/claim.js";
import type { VoterStore } from "../identity/store.js";
import type { VotingStore } from "../voting/store.js";
import { UnknownPollError } from "../voting/store.js";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SessionSigner,
} from "./session.js";

export interface ServerDeps {
  claims: ClaimService;
  voters: VoterStore;
  voting: VotingStore;
  signer: SessionSigner;
  /** Cookies go out secure everywhere except local development. */
  secureCookies?: boolean;
}

/**
 * Pulse's HTTP surface. Small on purpose — four things happen in this product:
 * ask for a sign-in link, redeem it, vote, read results.
 *
 * Error bodies are `{ error, message }` where `message` is a plain sentence the
 * UI can show as-is. Nothing here explains how anything is counted.
 */
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  const requireVoter = async (request: FastifyRequest, reply: FastifyReply) => {
    const voterId = deps.signer.verify(request.cookies[SESSION_COOKIE]);
    const voter = voterId ? await deps.voters.byId(voterId) : undefined;
    if (!voter) {
      // A cookie signed under a rotated secret, or for a voter that no longer
      // exists, is not an error to explain — it just means signed out.
      await reply
        .code(401)
        .send({ error: "signed_out", message: "Sign in to do that." });
      return undefined;
    }
    return voter;
  };

  app.post("/api/sign-in", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      wantsProofEmails?: unknown;
    };
    if (typeof body.email !== "string") {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Enter your email address." });
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
  });

  app.get("/api/sign-in/redeem", async (request, reply) => {
    const token = (request.query as { token?: unknown }).token;
    if (typeof token !== "string" || token === "") {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "That link is incomplete." });
    }

    const result = await deps.claims.redeem(token);
    if (result.status !== "signed_in") {
      const message =
        result.status === "already_used"
          ? "That link has already been used. Ask for a new one."
          : result.status === "expired"
            ? "That link has expired. Ask for a new one."
            : "That link is not one of ours. Ask for a new one.";
      return reply.code(410).send({ error: result.status, message });
    }

    reply.setCookie(SESSION_COOKIE, deps.signer.sign(result.voter.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: deps.secureCookies ?? true,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return reply.send({
      status: "signed_in",
      voter: publicVoter(result.voter),
      firstTime: result.firstTime,
    });
  });

  app.post("/api/sign-out", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ status: "signed_out" });
  });

  app.get("/api/me", async (request, reply) => {
    const voter = await requireVoter(request, reply);
    if (!voter) return reply;
    return reply.send({ voter: publicVoter(voter) });
  });

  app.get("/api/polls/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const poll = await deps.voting.getPoll(id);
    if (!poll) return notFound(reply);

    const voterId = deps.signer.verify(request.cookies[SESSION_COOKIE]);
    const yourVote = voterId
      ? await deps.voting.voteOf(id, voterId)
      : undefined;

    return reply.send({
      poll: {
        id: poll.id,
        question: poll.question,
        choices: poll.choices,
        closesAt: poll.closesAt?.toISOString() ?? null,
      },
      yourChoice: yourVote?.choice ?? null,
    });
  });

  app.get("/api/polls/:id/results", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await deps.voting.results(id));
    } catch (err) {
      if (err instanceof UnknownPollError) return notFound(reply);
      throw err;
    }
  });

  app.post("/api/polls/:id/vote", async (request, reply) => {
    const voter = await requireVoter(request, reply);
    if (!voter) return reply;

    const { id } = request.params as { id: string };
    const choice = (request.body as { choice?: unknown } | undefined)?.choice;
    if (typeof choice !== "number" || !Number.isInteger(choice)) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Pick one of the choices." });
    }

    try {
      const result = await deps.voting.castVote(id, voter.id, choice);
      switch (result.status) {
        case "counted":
          return reply.send({
            status: "counted",
            results: await deps.voting.results(id),
          });
        case "already_voted":
          return reply.code(409).send({
            error: "already_voted",
            message: "You have already voted on this.",
            yourChoice: result.vote.choice,
            results: await deps.voting.results(id),
          });
        case "closed":
          return reply.code(409).send({
            error: "closed",
            message: "Voting on this has closed.",
            results: await deps.voting.results(id),
          });
      }
    } catch (err) {
      if (err instanceof UnknownPollError) return notFound(reply);
      if (err instanceof RangeError) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "Pick one of the choices." });
      }
      throw err;
    }
  });

  return app;
}

/** What a voter is allowed to see about themselves. Never anyone else's. */
function publicVoter(voter: { id: string; email: string; community: string }) {
  return { id: voter.id, email: voter.email, community: voter.community };
}

function notFound(reply: FastifyReply) {
  return reply
    .code(404)
    .send({ error: "not_found", message: "That vote does not exist." });
}
