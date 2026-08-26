import { randomUUID } from "node:crypto";
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
import {
  SuggestionError,
  type Suggestion,
  type SuggestionStore,
} from "../voting/suggestions.js";
import { SESSION_COOKIE, SessionSigner } from "./session.js";

/**
 * Who cast a ballot, as far as the ballot is concerned.
 *
 * Deliberately not the signed-in voter. Votes are keyed by this and by nothing
 * else, whether or not the person has ever given an address, which is what lets
 * a vote count the moment it is cast and what keeps the record from holding a
 * connection between an address and an answer. Signing in verifies a person; it
 * is not how their vote is found.
 *
 * Signed by the session signer, which is safe in both directions: this cookie
 * presented as a session names a voter the store does not have, and a session
 * cookie presented as this one names the same person it already named.
 */
const BALLOT_COOKIE = "pulse_ballot";

/** Marks a ballot identity so it can never be mistaken for a voter id. */
const BALLOT_PREFIX = "b:";

export interface ServerDeps {
  claims: ClaimService;
  voters: VoterStore;
  votes: VotingStore;
  suggestions: SuggestionStore;
  signer: SessionSigner;
  /** Cookies go out secure everywhere except local development. */
  secureCookies?: boolean;
  /** Sign-in attempts allowed per client per window. */
  signInRateLimit?: { max: number; timeWindow: string };
  /** Suggestions allowed per client per window. */
  suggestRateLimit?: { max: number; timeWindow: string };
  /** Overridable so tests get a ballot identity they can predict. */
  newBallotId?: () => string;
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

  /**
   * The identity this ballot is filed under, minting one if this browser has
   * not voted before. Called only by the two routes that read or write a
   * ballot, so nothing else in the product hands out this cookie.
   */
  const ballotIdentity = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): string => {
    const held = deps.signer.verify(request.cookies[BALLOT_COOKIE]);
    if (held) return held.voterId;

    const minted = `${BALLOT_PREFIX}${(deps.newBallotId ?? randomUUID)()}`;
    reply.setCookie(BALLOT_COOKIE, deps.signer.sign(minted), {
      httpOnly: true,
      sameSite: "lax",
      secure: deps.secureCookies ?? true,
      path: "/",
      maxAge: deps.signer.ttlSeconds,
    });
    return minted;
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
        proofEmailsOptIn?: unknown;
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
        body.proofEmailsOptIn !== undefined &&
        typeof body.proofEmailsOptIn !== "boolean"
      ) {
        return reply.code(400).send({
          error: "bad_request",
          message: "Say yes or no to updates about what happens next.",
        });
      }

      const result = await deps.claims.requestLink(body.email, {
        proofEmailsOptIn: body.proofEmailsOptIn === true,
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
   *
   * The ballot identity goes with it. It has to: `pulse_ballot` lasts thirty
   * days and is what a ballot is filed under, so a browser that kept it after
   * a sign-out would hand the next person the previous person's ballot to read
   * and to overwrite. On a shared or public machine that is the one way pulse
   * can leak how somebody voted, and it is a wider hole than the per-browser
   * deduplication weakness `API.md` already owns up to.
   *
   * The vote itself is not withdrawn — it stays counted under the identity
   * that cast it. What ends is this browser's ability to see or change it,
   * which is the same thing signing out means for everything else.
   *
   * The cost is real and accepted: signing in again mints a new ballot
   * identity, so the same person voting again after a sign-out is counted
   * twice. Pulse is counted-not-verified and already says deduplication is per
   * browser; being double-counted is a smaller harm than being read.
   */
  app.post("/api/sign-out", async (request, reply) => {
    const voter = await currentVoter(request);
    if (voter) await deps.voters.invalidateSessionsBefore(voter.id, now());
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(BALLOT_COOKIE, { path: "/" });
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
    const poll = await deps.votes.getPoll(pollId(request));
    if (!poll) return notFoundPoll(reply);
    const vote = await deps.votes.voteOf(
      poll.id,
      ballotIdentity(request, reply),
    );
    return reply.send({ ballot: vote ? vote.choices : null });
  });

  /**
   * Casting needs no session, on purpose. A vote counts the moment it is made;
   * the address someone gives later verifies that vote, and never gates it.
   */
  app.post("/api/polls/:id/votes", async (request, reply) => {
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
        ballotIdentity(request, reply),
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

  app.get("/api/polls/:id/suggestions", async (request, reply) => {
    const poll = await deps.votes.getPoll(pollId(request));
    if (!poll) return notFoundPoll(reply);
    const suggestions = await deps.suggestions.list(poll.id);
    return reply.send({ suggestions: suggestions.map(publicSuggestion) });
  });

  /**
   * Add an option of your own.
   *
   * The answer says whether anyone had already said it and what else came
   * close. That is the whole of the duplicate handling between suggestions:
   * the person is told, and nothing is refused for being similar. Refusing
   * would make people phrase around the check, which is how a list of options
   * turns into a list of synonyms.
   *
   * Repeating one of the poll's own choices is the exception, and answers
   * `on_ballot`. Nothing is added there because a suggestion can never become
   * a choice on this poll, so leaving one would put an unvotable copy of an
   * option under the option itself.
   */
  app.post(
    "/api/polls/:id/suggestions",
    {
      config: {
        rateLimit: deps.suggestRateLimit ?? { max: 20, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const poll = await deps.votes.getPoll(pollId(request));
      if (!poll) return notFoundPoll(reply);
      if (!poll.acceptsSuggestions) {
        return reply.code(409).send({
          error: "no_suggestions",
          message: "This question has a fixed set of answers.",
        });
      }
      if (!isOpen(poll, now())) {
        return reply.code(409).send({
          error: "closed",
          message: "This one has closed.",
        });
      }

      const text = (request.body as { text?: unknown } | undefined)?.text;
      if (typeof text !== "string") {
        return reply.code(400).send({
          error: "bad_request",
          message: "Write what you would rather see.",
        });
      }

      try {
        const result = await deps.suggestions.submit(poll, text);
        const related = result.related.map(publicSuggestion);
        if (result.status === "on_ballot") {
          // Not an error: the person said something the poll already offers,
          // and the answer names the choice so the screen can point at it.
          return reply.send({
            status: result.status,
            choice: result.choice,
            related,
          });
        }
        return reply.send({
          status: result.status,
          suggestion: publicSuggestion(result.suggestion),
          related,
        });
      } catch (error) {
        if (error instanceof SuggestionError) {
          return reply
            .code(400)
            .send({ error: "bad_suggestion", message: error.message });
        }
        throw error;
      }
    },
  );

  return app;
}

/** A suggestion as anyone may see it. Who said it is not recorded at all. */
function publicSuggestion(suggestion: Suggestion) {
  return {
    id: suggestion.id,
    text: suggestion.text,
    count: suggestion.count,
  };
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
    next: [...poll.next],
    acceptsSuggestions: poll.acceptsSuggestions,
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
