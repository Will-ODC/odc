import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CreationError } from "../authoring/input.js";
import {
  PollPictureError,
  type PollPictureStore,
} from "../authoring/poll-picture.js";
import type { PublicationActor } from "../authoring/store.js";
import { isStorageUnavailable } from "../db/unavailable.js";
import type { Voter } from "../identity/store.js";
import { pictureInput, pictureRemovalQuery } from "../images/input.js";
import { publicImage } from "../images/public.js";
import { logFault } from "../logging.js";
import { UnknownPollError } from "../voting/store.js";
import { originAllowed } from "./origin.js";

interface Deps {
  pictures: PollPictureStore | undefined;
  webOrigin: string | undefined;
  currentVoter(request: FastifyRequest): Promise<Voter | undefined>;
}

const actor = Symbol("poll picture actor");
type Authenticated = FastifyRequest & { [actor]?: PublicationActor };
const utf8 = new TextDecoder("utf-8", { fatal: true });
const path = "/api/polls/:id/image";
const errors = {
  bad_request: [400, "Check the picture and its description, then try again."],
  signed_out: [401, "Sign in to manage this picture."],
  origin_not_allowed: [403, "Open this site to send that request."],
  poster_required: [403, "Only the poster can do that."],
  not_found: [404, "There is no such poll."],
  image_changed: [
    409,
    "The picture changed, so it wasn't removed. Check it and try again.",
  ],
  body_too_large: [413, "That request is too large to send."],
  image_unavailable: [
    422,
    "That picture is no longer available. Add it again.",
  ],
  too_many_requests: [429, "Too many tries just now. Try again later."],
  images_unavailable: [503, "Pictures are unavailable just now. Try again."],
  server_error: [500, "Something went wrong. Try again."],
} as const;

function refuse(reply: FastifyReply, code: keyof typeof errors) {
  const [status, message] = errors[code];
  return reply.code(status).send({ error: code, message });
}

export function notFoundPoll(reply: FastifyReply) {
  return refuse(reply, "not_found");
}

export async function registerPollPictureRoutes(
  app: FastifyInstance,
  deps: Deps,
): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    scope.setErrorHandler((error, request, reply) => {
      if (error instanceof PollPictureError) return refuse(reply, error.code);
      if (error instanceof UnknownPollError) return notFoundPoll(reply);
      if (error instanceof CreationError && error.code === "signed_out")
        return refuse(reply, "signed_out");
      if (isStorageUnavailable(error))
        return refuse(reply, "images_unavailable");
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 413) return refuse(reply, "body_too_large");
      if (status === 429) return refuse(reply, "too_many_requests");
      if (status && status >= 400 && status < 500)
        return refuse(reply, "bad_request");
      logFault(
        request.log.error.bind(request.log),
        error,
        "poll picture request failed",
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
          text = utf8.decode(body as Buffer);
        } catch {
          done(
            Object.assign(new Error("invalid UTF-8"), { statusCode: 400 }),
            undefined,
          );
          return;
        }
        json(request, text, done);
      },
    );
    const options = {
      bodyLimit: 32 * 1024,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      // The rate limiter runs first, before authentication or body parsing.
      preParsing: async <T>(
        request: FastifyRequest,
        reply: FastifyReply,
        payload: T,
      ) => {
        const { method, headers } = request;
        if (
          (method === "PUT" || method === "DELETE") &&
          !originAllowed(request, deps.webOrigin)
        )
          return refuse(reply, "origin_not_allowed");
        const voter = await deps.currentVoter(request);
        if (!voter) return refuse(reply, "signed_out");
        if (!deps.pictures) return refuse(reply, "images_unavailable");
        (request as Authenticated)[actor] = {
          voterId: voter.id,
          sessionGeneration: voter.sessionGeneration ?? 0,
        };
        const contentType = headers["content-type"]?.split(";")[0];
        const length = headers["content-length"];
        if (
          (method === "PUT" &&
            contentType?.trim().toLowerCase() !== "application/json") ||
          (method === "DELETE" &&
            (headers["transfer-encoding"] !== undefined ||
              (length !== undefined && length !== "0")))
        )
          return refuse(reply, "bad_request");
        return payload;
      },
    };
    scope.get(path, options, async (request) => {
      const { store, who, id } = authorized(request);
      return { canManage: await store.canManagePicture(who.voterId, id) };
    });
    scope.put(path, options, async (request, reply) => {
      const { store, who, id } = authorized(request);
      const input = pictureInput.safeParse(request.body);
      if (!input.success) return refuse(reply, "bad_request");
      const image = await store.changePicture(who, id, {
        action: "image_replace",
        input: input.data,
      });
      return { image: publicImage(image) };
    });
    scope.delete(path, options, async (request, reply) => {
      const { store, who, id } = authorized(request);
      const query = pictureRemovalQuery.safeParse(request.query);
      if (!query.success) return refuse(reply, "bad_request");
      const { expectedImageId } = query.data;
      const image = await store.changePicture(who, id, {
        action: "image_remove",
        ...(expectedImageId === undefined ? {} : { expectedImageId }),
      });
      return { image: publicImage(image) };
    });
  });

  function authorized(request: FastifyRequest) {
    const who = (request as Authenticated)[actor];
    if (!deps.pictures || !who)
      throw new Error("poll picture guard did not run");
    const { id } = request.params as { id: string };
    return { store: deps.pictures, who, id };
  }
}
