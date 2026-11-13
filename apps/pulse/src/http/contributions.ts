import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Voter } from "../identity/store.js";
import { ContributionError, listQuery } from "../contributions/input.js";
import type { ContributionsStore } from "../contributions/store.js";
import { isStorageUnavailable } from "../db/unavailable.js";
import { logFault } from "../logging.js";
import { originAllowed } from "./origin.js";
interface Deps {
  contributions: ContributionsStore | undefined;
  webOrigin: string | undefined;
  currentVoter: (request: FastifyRequest) => Promise<Voter | undefined>;
}
const actor = Symbol("contribution actor");
type Authenticated = FastifyRequest & { [actor]?: Voter };
const errors = {
  bad_request: [
    400,
    "Check the fields and try again. Commercial offers need at least 20% savings.",
  ],
  account_changed: [409, "Your account changed, so this wasn't sent."],
  signed_out: [401, "Sign in to contribute."],
  organizer_required: [403, "Only the organizer can do that."],
  origin_not_allowed: [403, "Open this site to send that request."],
  not_found: [404, "That contribution could not be found."],
  poll_not_found: [404, "Check the related poll ID or leave that field blank."],
  idempotency_conflict: [
    409,
    "That request was already used. Start a new submission.",
  ],
  posting_limit: [
    429,
    "You have posted five contributions in the last hour. Try again later.",
  ],
  closed: [
    409,
    "This contribution is closed to new offers of help and pledges.",
  ],
  record_full: [409, "This contribution has reached its entry limit."],
  sender_limit: [
    409,
    "You have reached your entry limit for this contribution.",
  ],
  body_too_large: [413, "That request is too large to send."],
  too_many_requests: [429, "Too many tries just now. Try again later."],
  contributions_unavailable: [
    503,
    "Contributions are unavailable just now. Try again.",
  ],
  server_error: [500, "Something went wrong. Try again."],
} as const;
function refuse(reply: FastifyReply, code: keyof typeof errors) {
  const [status, message] = errors[code];
  return reply.code(status).send({ error: code, message });
}
export async function registerContributionRoutes(
  app: FastifyInstance,
  deps: Deps,
): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    scope.setErrorHandler((error, request, reply) => {
      if (error instanceof ContributionError) return refuse(reply, error.code);
      if (isStorageUnavailable(error))
        return refuse(reply, "contributions_unavailable");
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 413) return refuse(reply, "body_too_large");
      if (status === 429) return refuse(reply, "too_many_requests");
      if (status && status >= 400 && status < 500)
        return refuse(reply, "bad_request");
      logFault(
        request.log.error.bind(request.log),
        error,
        "contributions request failed",
      );
      return refuse(reply, "server_error");
    });
    const json = scope.getDefaultJsonParser("error", "error");
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            body as Buffer,
          );
        } catch {
          done(new ContributionError("bad_request"), undefined);
          return;
        }
        json(request, text, done);
      },
    );
    const readGuard = async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.contributions)
        return refuse(reply, "contributions_unavailable");
    };
    const mutationGuard = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (!deps.contributions)
        return refuse(reply, "contributions_unavailable");
      if (!originAllowed(request, deps.webOrigin))
        return refuse(reply, "origin_not_allowed");
      const voter = await deps.currentVoter(request);
      if (!voter) return refuse(reply, "signed_out");
      (request as Authenticated)[actor] = voter;
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return refuse(reply, "bad_request");
    };
    const readOptions = {
      onRequest: readGuard,
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    };
    const writeOptions = {
      onRequest: mutationGuard,
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body))
          return refuse(reply, "bad_request");
        const { accountId, ...fields } = body as Record<string, unknown>;
        if (typeof accountId !== "string" || accountId.length === 0)
          return refuse(reply, "bad_request");
        // The draft's account is a precondition, never a choice of author.
        // Check before entering storage, even for an idempotent retry.
        if (accountId !== (request as Authenticated)[actor]?.id)
          return refuse(reply, "account_changed");
        request.body = fields;
      },
      bodyLimit: 32 * 1024,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    };
    scope.get("/api/contributions", readOptions, async (request) =>
      store().list(listQuery(request.query)),
    );
    scope.get("/api/contributions/:id", readOptions, async (request) => {
      const voter = await deps.currentVoter(request);
      return store().detail(id(request), voter?.id);
    });
    scope.get(
      "/api/contributions/:id/messages",
      readOptions,
      async (request) => {
        const voter = await deps.currentVoter(request);
        if (!voter) throw new ContributionError("signed_out");
        return store().messages(
          {
            voterId: voter.id,
            sessionGeneration: voter.sessionGeneration ?? 0,
          },
          id(request),
        );
      },
    );
    scope.post(
      "/api/contributions/:id/messages",
      writeOptions,
      async (request, reply) => {
        const voter = (request as Authenticated)[actor];
        if (!voter) throw new ContributionError("signed_out");
        const key = request.headers["idempotency-key"];
        const result = await store().sendMessage(
          {
            voterId: voter.id,
            sessionGeneration: voter.sessionGeneration ?? 0,
          },
          id(request),
          typeof key === "string" ? key : "",
          request.body,
        );
        return reply.code(result.replayed ? 200 : 201).send(result);
      },
    );
    for (const operation of ["create", "participate", "update"] as const) {
      const path =
        operation === "create"
          ? "/api/contributions"
          : `/api/contributions/:id/${operation === "participate" ? "participations" : "updates"}`;
      scope.post(path, writeOptions, async (request, reply) => {
        const voter = (request as Authenticated)[actor];
        if (!voter) throw new ContributionError("signed_out");
        const who = {
          voterId: voter.id,
          sessionGeneration: voter.sessionGeneration ?? 0,
        };
        const header = request.headers["idempotency-key"];
        const key = typeof header === "string" ? header : "";
        const result =
          operation === "create"
            ? await store().create(who, key, request.body)
            : await store()[operation](who, id(request), key, request.body);
        return reply.code(result.replayed ? 200 : 201).send(result);
      });
    }
    function store(): ContributionsStore {
      if (!deps.contributions)
        throw new Error("contributions unavailable after guard");
      return deps.contributions;
    }
  });
}
function id(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}
