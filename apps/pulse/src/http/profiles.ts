import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Voter } from "../identity/store.js";
import { logFault } from "../logging.js";
import {
  isPublicProfileId,
  normalizeProfile,
  ProfileInputError,
} from "../profiles/input.js";
import {
  ProfileStoreError,
  type MemberProfile,
  type MemberProfileStore,
  type ProfileActor,
} from "../profiles/store.js";
import { ORIGIN_REFUSAL, originAllowed } from "./origin.js";

export const PROFILE_BODY_LIMIT = 2 * 1024;

export interface ProfileRouteDeps {
  profiles: MemberProfileStore | undefined;
  webOrigin: string | undefined;
  currentVoter: (request: FastifyRequest) => Promise<Voter | undefined>;
  rateLimit?: { max: number; timeWindow: string };
}

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

const NOT_FOUND = () =>
  new Refusal(404, "not_found", "That profile is unavailable.");
const SIGNED_OUT = () => new Refusal(401, "signed_out", "Sign in to do that.");
const BAD_REQUEST = () =>
  new Refusal(400, "bad_request", "That request could not be read.");
const FOREIGN_ORIGIN = () =>
  new Refusal(
    ORIGIN_REFUSAL.status,
    ORIGIN_REFUSAL.error,
    ORIGIN_REFUSAL.message,
  );

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: ProfileRouteDeps,
): Promise<void> {
  app.get("/api/profiles/:publicId", async (request, reply) => {
    const publicId = (request.params as { publicId: string }).publicId;
    if (!isPublicProfileId(publicId) || !deps.profiles)
      return answerRefusal(reply, NOT_FOUND());
    const profile = await deps.profiles.publicById(publicId.toLowerCase());
    if (!profile) return answerRefusal(reply, NOT_FOUND());
    return reply.header("cache-control", "no-store").send({
      publicId: profile.publicId,
      displayName: profile.displayName,
      bio: profile.bio,
      createdAt: profile.createdAt.toISOString(),
    });
  });

  await app.register(async (scope) => {
    const json = scope.getDefaultJsonParser("error", "error");
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        try {
          json(request, utf8.decode(body as Buffer), done);
        } catch {
          done(BAD_REQUEST(), undefined);
        }
      },
    );
    scope.setErrorHandler((error, request, reply) => {
      if (error instanceof Refusal) return answerRefusal(reply, error);
      if (error instanceof ProfileInputError)
        return answerRefusal(reply, BAD_REQUEST());
      if (error instanceof ProfileStoreError)
        return answerRefusal(reply, SIGNED_OUT());
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 413)
        return answerRefusal(
          reply,
          new Refusal(
            413,
            "body_too_large",
            "That request is too large to send.",
          ),
        );
      if (status === 429)
        return answerRefusal(
          reply,
          new Refusal(
            429,
            "too_many_requests",
            "Too many tries just now. Try again a little later.",
          ),
        );
      if (status !== undefined && status >= 400 && status < 500)
        return answerRefusal(reply, BAD_REQUEST());
      logFault(
        request.log.error.bind(request.log),
        error,
        "profile request failed",
      );
      return reply.code(500).header("cache-control", "no-store").send({
        error: "server_error",
        message: "Something went wrong. Try again.",
      });
    });

    const limit = {
      rateLimit: deps.rateLimit ?? { max: 30, timeWindow: "1 minute" },
    };
    const actor = async (request: FastifyRequest): Promise<ProfileActor> => {
      const voter = await deps.currentVoter(request);
      if (!voter) throw SIGNED_OUT();
      if (!deps.profiles) throw new Error("profile storage unavailable");
      return {
        voterId: voter.id,
        sessionGeneration: voter.sessionGeneration ?? 0,
      };
    };
    const guard = (write: boolean) =>
      async function profileGuard<T>(
        request: FastifyRequest,
        _reply: FastifyReply,
        payload: T,
      ): Promise<T> {
        if (write && !originAllowed(request, deps.webOrigin))
          throw FOREIGN_ORIGIN();
        if (write && !isJson(request)) throw BAD_REQUEST();
        (request as WithActor)[ACTOR] = await actor(request);
        return payload;
      };

    scope.get(
      "/api/me/profile",
      { config: limit, preParsing: guard(false) },
      async (request, reply) => {
        const profile = await deps.profiles?.byOwner(actorOf(request));
        return reply
          .header("cache-control", "no-store")
          .send({ profile: profile ? ownerProfile(profile) : null });
      },
    );

    scope.put(
      "/api/me/profile",
      {
        bodyLimit: PROFILE_BODY_LIMIT,
        config: limit,
        preParsing: guard(true),
      },
      async (request, reply) => {
        const profile = await deps.profiles?.save(
          actorOf(request),
          normalizeProfile(request.body),
        );
        if (!profile) throw new Error("profile storage unavailable");
        return reply
          .header("cache-control", "no-store")
          .send({ profile: ownerProfile(profile) });
      },
    );
  });
}

const ACTOR = Symbol("profile actor");
type WithActor = FastifyRequest & { [ACTOR]?: ProfileActor };
function actorOf(request: FastifyRequest): ProfileActor {
  const value = (request as WithActor)[ACTOR];
  if (!value) throw new Error("profile guard did not authenticate an actor");
  return value;
}

function ownerProfile(profile: MemberProfile) {
  return {
    publicId: profile.publicId,
    displayName: profile.displayName,
    bio: profile.bio,
    visible: profile.visible,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function answerRefusal(reply: FastifyReply, refusal: Refusal) {
  return reply.code(refusal.status).header("cache-control", "no-store").send({
    error: refusal.slug,
    message: refusal.sentence,
  });
}

function isJson(request: FastifyRequest): boolean {
  return (
    (request.headers["content-type"]?.split(";")[0] ?? "")
      .trim()
      .toLowerCase() === "application/json"
  );
}
