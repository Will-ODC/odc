import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { CreationError } from "../authoring/input.js";
import type {
  CreationStore,
  PublicationActor,
  PublicationPoll,
} from "../authoring/store.js";
import { isStorageUnavailable } from "../db/unavailable.js";
import type { Voter } from "../identity/store.js";

/** ADR-0037: a creation request is at most 32 KiB of UTF-8. */
export const CREATION_BODY_LIMIT = 32 * 1024;

/** `{ "permission": "unlimited_posting" }` is small; nothing bigger is read. */
const PERMISSION_BODY_LIMIT = 1024;

export interface CreationRouteDeps {
  /** Absent means creation is switched off: every route answers 503. */
  creation: CreationStore | undefined;
  /**
   * The only `Origin` a mutation is accepted from. Trusted configuration —
   * never derived from `Host` or a forwarded header. Absent refuses every
   * mutation: there is no origin it could match.
   */
  webOrigin: string | undefined;
  /** The signed-in voter for this request, or undefined. Checks expiry and generation. */
  currentVoter: (request: FastifyRequest) => Promise<Voter | undefined>;
  /**
   * Requests allowed per client per window, per route. Separate from the
   * five-an-hour posting quota: this one counts every request, refused,
   * replayed or not, because each costs an account lookup and a row lock.
   */
  rateLimit?: { max: number; timeWindow: string };
}

/** One refusal, in the `{ error, message }` envelope every route answers with. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly sentence: string,
  ) {
    super(slug);
    this.name = "Refusal";
  }
}

const UNAVAILABLE = () =>
  new Refusal(
    503,
    "creation_unavailable",
    "Posting is not available just now. Try again.",
  );
const BAD_REQUEST = () =>
  new Refusal(400, "bad_request", "That request could not be read.");
const SIGNED_OUT = () => new Refusal(401, "signed_out", "Sign in to do that.");
const FOREIGN_ORIGIN = () =>
  new Refusal(
    403,
    "origin_not_allowed",
    "That request did not come from Pulse.",
  );
const TOO_MANY = () =>
  new Refusal(
    429,
    "too_many_requests",
    "Too many tries just now. Try again a little later.",
  );
const TOO_LARGE = () =>
  new Refusal(413, "body_too_large", "That request is too large to send.");

/** What a store refusal means on the wire. Exhaustive over `CreationError`. */
function fromCreationError(error: CreationError): Refusal {
  switch (error.code) {
    case "bad_request":
      return BAD_REQUEST();
    case "signed_out":
      return SIGNED_OUT();
    case "purpose_required":
      return new Refusal(
        422,
        "purpose_required",
        "Agree to the community promise before your first post.",
      );
    case "idempotency_conflict":
      return new Refusal(
        409,
        "idempotency_conflict",
        "That request was already used for a different question.",
      );
    case "posting_limit":
      return new Refusal(
        429,
        "posting_limit",
        "You have posted five questions in the last hour. Try again later.",
      );
    case "owner_required":
      return new Refusal(403, "owner_required", "Only the owner can do that.");
    case "not_found":
      return new Refusal(404, "not_found", "There is no such account.");
  }
}

/** Per request: the account the guards authenticated. */
const ACTOR = Symbol("creation actor");
type WithActor = FastifyRequest & { [ACTOR]?: PublicationActor };

/**
 * Poll creation and posting permission (ADR-0037).
 *
 * Registered in a scope of its own so that its JSON parser, its body limits
 * and its error handler apply to these routes and nothing else.
 *
 * Every request is first counted by the per-client rate limit (`onRequest`,
 * 429 `too_many_requests`), so refused requests are limited too. Then it
 * passes the same guards, in `preParsing` — before Fastify reads a byte of the
 * body — and in this order:
 *
 * 1. creation configured at all, else 503;
 * 2. for a mutation, `Origin` exactly the configured web origin, else 403;
 * 3. a current session (signature, expiry, generation), else 401;
 * 4. for a mutation with a body, `Content-Type: application/json`, and for
 *    DELETE, no body at all; else 400.
 *
 * Only then is the body parsed, and only then is the store asked anything.
 * The store re-checks the session generation inside its own transaction, so a
 * sign-out racing a request still wins.
 *
 * Nothing here reads, mints or clears the ballot cookie: creating a question
 * is not voting, and the author reference must never meet a ballot.
 *
 * Nothing here logs a body, an idempotency key, an account id or an address.
 * Unplanned faults are logged by class and code only (see `logFault`).
 */
export async function registerCreationRoutes(
  app: FastifyInstance,
  deps: CreationRouteDeps,
): Promise<void> {
  await app.register(async (scope) => {
    // Strict UTF-8. Fastify's own JSON parser decodes leniently, turning
    // invalid bytes into U+FFFD, which would publish text nobody wrote. The
    // decoded string then goes to Fastify's parser so prototype-poisoning
    // protection is unchanged.
    const json = scope.getDefaultJsonParser("error", "error");
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        let text: string;
        try {
          text = utf8.decode(body as Buffer);
        } catch {
          done(BAD_REQUEST(), undefined);
          return;
        }
        json(request, text, done);
      },
    );

    scope.setErrorHandler((error, request, reply) =>
      answer(request, reply, error),
    );

    const guard = (kind: "read" | "json" | "bodyless") =>
      async function creationGuard<T>(
        request: FastifyRequest,
        _reply: FastifyReply,
        payload: T,
      ): Promise<T> {
        if (!deps.creation) throw UNAVAILABLE();
        if (kind !== "read") {
          const origin = request.headers.origin;
          if (deps.webOrigin === undefined || origin !== deps.webOrigin)
            throw FOREIGN_ORIGIN();
        }
        const voter = await deps.currentVoter(request);
        if (!voter) throw SIGNED_OUT();
        (request as WithActor)[ACTOR] = {
          voterId: voter.id,
          sessionGeneration: voter.sessionGeneration ?? 0,
        };
        if (kind === "json" && !isJson(request)) throw BAD_REQUEST();
        if (kind === "bodyless" && hasBody(request)) throw BAD_REQUEST();
        return payload;
      };
    const limit = {
      rateLimit: deps.rateLimit ?? { max: 30, timeWindow: "1 minute" },
    };

    scope.get(
      "/api/poll-creation/context",
      { preParsing: guard("read"), config: limit },
      async (request, reply) => {
        const context = await store(deps).context(actor(request));
        return reply.header("cache-control", "no-store").send({
          community: {
            id: context.community.id,
            label: context.community.label,
          },
          canPostUnlimited: context.canPostUnlimited,
          purposeVersion: context.purposeVersion,
          purposeAcknowledged: context.purposeAcknowledged,
        });
      },
    );

    scope.post(
      "/api/polls",
      {
        preParsing: guard("json"),
        bodyLimit: CREATION_BODY_LIMIT,
        config: limit,
      },
      async (request, reply) => {
        const key = request.headers["idempotency-key"];
        const result = await store(deps).publish(
          actor(request),
          typeof key === "string" ? key : "",
          request.body,
        );
        return reply
          .code(result.replayed ? 200 : 201)
          .header("cache-control", "no-store")
          .send({
            poll: publicPoll(result.poll),
            replayed: result.replayed,
          });
      },
    );

    scope.put(
      "/api/posting-permissions/:voterId",
      {
        preParsing: guard("json"),
        bodyLimit: PERMISSION_BODY_LIMIT,
        config: limit,
      },
      async (request, reply) => {
        const body = request.body;
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          (body as { permission?: unknown }).permission !== "unlimited_posting"
        )
          throw BAD_REQUEST();
        await store(deps).setUnlimited(actor(request), target(request), true);
        return reply.code(204).send();
      },
    );

    scope.delete(
      "/api/posting-permissions/:voterId",
      {
        preParsing: guard("bodyless"),
        bodyLimit: PERMISSION_BODY_LIMIT,
        config: limit,
      },
      async (request, reply) => {
        await store(deps).setUnlimited(actor(request), target(request), false);
        return reply.code(204).send();
      },
    );
  });
}

function store(deps: CreationRouteDeps): CreationStore {
  // The guard already refused when there is none; this only narrows the type.
  if (!deps.creation) throw UNAVAILABLE();
  return deps.creation;
}

function actor(request: FastifyRequest): PublicationActor {
  const found = (request as WithActor)[ACTOR];
  // Unreachable: every route's guard sets it or refuses. Refused, not trusted.
  if (!found) throw SIGNED_OUT();
  return found;
}

function target(request: FastifyRequest): string {
  return (request.params as { voterId: string }).voterId;
}

/** `application/json`, with or without parameters, and nothing else. */
function isJson(request: FastifyRequest): boolean {
  const header = request.headers["content-type"];
  if (typeof header !== "string") return false;
  return (
    (header.split(";")[0] ?? "").trim().toLowerCase() === "application/json"
  );
}

/** A DELETE here carries nothing, and a body is refused rather than ignored. */
function hasBody(request: FastifyRequest): boolean {
  const length = request.headers["content-length"];
  return (
    request.headers["transfer-encoding"] !== undefined ||
    (length !== undefined && length !== "0")
  );
}

/**
 * The public poll, rebuilt field by field. The store already returns only
 * public fields; this is the allow-list that keeps it so if the store's shape
 * ever grows something private.
 */
function publicPoll(poll: PublicationPoll) {
  return {
    id: poll.id,
    question: poll.question,
    choices: [...poll.choices],
    method: poll.method,
    next: [...poll.next],
    acceptsSuggestions: poll.acceptsSuggestions,
    closesAt: poll.closesAt,
    open: poll.open,
    community: { id: poll.community.id, label: poll.community.label },
    attribution:
      poll.attribution.kind === "named"
        ? { kind: "named" as const, name: poll.attribution.name }
        : { kind: "anonymous" as const },
  };
}

function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  const refusal = classify(error);
  if (refusal.status === 500) logFault(request, error);
  if (
    error instanceof CreationError &&
    error.code === "posting_limit" &&
    error.retryAfter !== undefined
  )
    reply.header(
      "retry-after",
      String(Math.max(1, Math.ceil(error.retryAfter))),
    );
  return reply
    .code(refusal.status)
    .header("cache-control", "no-store")
    .send({ error: refusal.slug, message: refusal.sentence });
}

function classify(error: unknown): Refusal {
  if (error instanceof Refusal) return error;
  if (error instanceof CreationError) return fromCreationError(error);
  if (isStorageUnavailable(error)) return UNAVAILABLE();
  const status = (error as Partial<FastifyError>).statusCode;
  if (status === 413) return TOO_LARGE();
  if (status === 429) return TOO_MANY();
  // Fastify's own refusals while reading the body — malformed JSON, an empty
  // body, a bad Content-Length. All of them are the contract's one 400.
  if (typeof status === "number" && status >= 400 && status < 500)
    return BAD_REQUEST();
  return new Refusal(500, "server_error", "Something went wrong. Try again.");
}

/**
 * An unplanned fault, written down without anything that could be private.
 *
 * A database error's `detail` quotes the row it tripped on — an account id,
 * an idempotency key — and its message can quote an input value. So a
 * database error is logged by class and SQLSTATE only. Other errors are
 * pulse's own or the runtime's, and their message and stack are kept, because
 * a 500 nobody can diagnose is its own outage.
 */
function logFault(request: FastifyRequest, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const fromDatabase = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
  if (fromDatabase || !(error instanceof Error)) {
    request.log.error(
      {
        fault: {
          type: error instanceof Error ? error.name : typeof error,
          ...(typeof code === "string" ? { code } : {}),
        },
      },
      "poll creation failed",
    );
    return;
  }
  request.log.error(
    { fault: { type: error.name, message: error.message, stack: error.stack } },
    "poll creation failed",
  );
}
