import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { isStorageUnavailable } from "../db/unavailable.js";
import type { Voter } from "../identity/store.js";
import {
  IMAGE_ID,
  MAX_UPLOAD_BYTES,
  UPLOAD_TYPES,
  type Variant,
} from "../images/limits.js";
import {
  DecodeQueue,
  ImageRefusal,
  processImage,
  type ImageProcessor,
} from "../images/process.js";
import {
  ImageStoreError,
  type ImageActor,
  type ImageStore,
} from "../images/store.js";
import { logFault } from "../logging.js";
import { ORIGIN_REFUSAL, originAllowed } from "./origin.js";

export interface ImageRouteDeps {
  /** Absent: uploads answer 503 and every picture is the one 404. */
  images: ImageStore | undefined;
  /** The only `Origin` an upload is accepted from (trusted configuration). */
  webOrigin: string | undefined;
  /** The signed-in voter for this request, or undefined. */
  currentVoter: (request: FastifyRequest) => Promise<Voter | undefined>;
  /** Defaults to `processImage` (sharp). Tests may slow or replace it. */
  processor?: ImageProcessor;
  /** Defaults to one decode at a time and four waiting. */
  queue?: DecodeQueue;
  /** Upload requests per client per window (ADR-0047: 10 a minute). */
  uploadRateLimit?: { max: number; timeWindow: string };
  /** Picture reads per client per window. */
  readRateLimit?: { max: number; timeWindow: string };
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
    "images_unavailable",
    "Pictures are not available just now. Try again.",
  );
const SIGNED_OUT = () => new Refusal(401, "signed_out", "Sign in to do that.");
const FOREIGN_ORIGIN = () =>
  new Refusal(
    ORIGIN_REFUSAL.status,
    ORIGIN_REFUSAL.error,
    ORIGIN_REFUSAL.message,
  );
const UNSUPPORTED = () =>
  new Refusal(
    415,
    "unsupported_image",
    "That picture can't be used. Choose a still JPEG, PNG or WebP photo.",
  );

function fromImageRefusal(error: ImageRefusal): Refusal {
  switch (error.code) {
    case "unsupported_image":
      return UNSUPPORTED();
    case "image_dimensions":
      return new Refusal(
        422,
        "image_dimensions",
        "That picture is too small or too big. Use one at least 200 pixels on its shorter side and at most 8,000 pixels on either side.",
      );
    case "image_busy":
      return new Refusal(
        503,
        "image_busy",
        "Pictures are busy just now. Try again in a moment.",
      );
  }
}

function fromStoreError(error: ImageStoreError): Refusal {
  switch (error.code) {
    case "signed_out":
      return SIGNED_OUT();
    case "upload_limit":
      return new Refusal(
        429,
        "upload_limit",
        "You have added 20 pictures in the last hour. Try again later.",
      );
    case "pending_limit":
      return new Refusal(
        429,
        "pending_limit",
        "You have five pictures not yet posted. Post a question with one, or try again later.",
      );
  }
}

/** Per request: the account the guard authenticated. */
const ACTOR = Symbol("image actor");
type WithActor = FastifyRequest & { [ACTOR]?: ImageActor };

/** The one 404 for every picture refusal: the same as any unknown path. */
const NOT_FOUND = { error: "not_found", message: "There is nothing here." };

/**
 * Poll pictures (ADR-0047 sections 2 to 4 and 11).
 *
 * `POST /api/poll-images` takes the raw file as the body. Every request is
 * first counted by the per-client rate limit, then passes, before a byte of
 * the body is read: pictures configured (503), `Origin` (403), a current
 * session (401), and a declared type of JPEG, PNG or WebP (415). The body is
 * then read up to 10 MiB (413). Pending pictures past their 24 hours are
 * swept, the account's quota is checked before any decode, and only then is
 * the file decoded — judged by its content, never its declared type —
 * re-encoded and stored as a pending picture.
 *
 * `GET /api/poll-images/:id/display.webp` and `/thumb.webp` need no session
 * and set or read no cookie. `:id` must be a lowercase UUID before anything
 * is queried. Malformed, unknown, pending and unservable pictures all answer
 * the same 404 as any unknown path, with the same body.
 *
 * Nothing here logs a body, a picture's bytes or an account id. Unplanned
 * faults are logged by class and code only (see `logFault`).
 */
export async function registerImageRoutes(
  app: FastifyInstance,
  deps: ImageRouteDeps,
): Promise<void> {
  const processor = deps.processor ?? processImage;
  const queue = deps.queue ?? new DecodeQueue();

  await app.register(async (scope) => {
    scope.addContentTypeParser(
      [...UPLOAD_TYPES],
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    scope.setErrorHandler((error, request, reply) =>
      answer(request, reply, error),
    );

    scope.post(
      "/api/poll-images",
      {
        preParsing: async function uploadGuard<T>(
          request: FastifyRequest,
          _reply: FastifyReply,
          payload: T,
        ): Promise<T> {
          if (!deps.images) throw UNAVAILABLE();
          if (!originAllowed(request, deps.webOrigin)) throw FOREIGN_ORIGIN();
          const voter = await deps.currentVoter(request);
          if (!voter) throw SIGNED_OUT();
          (request as WithActor)[ACTOR] = {
            voterId: voter.id,
            sessionGeneration: voter.sessionGeneration ?? 0,
          };
          if (!declaredUpload(request)) throw UNSUPPORTED();
          return payload;
        },
        bodyLimit: MAX_UPLOAD_BYTES,
        config: {
          rateLimit: deps.uploadRateLimit ?? {
            max: 10,
            timeWindow: "1 minute",
          },
        },
      },
      async (request, reply) => {
        const images = deps.images;
        const actor = (request as WithActor)[ACTOR];
        // Unreachable: the guard set both or refused.
        if (!images) throw UNAVAILABLE();
        if (!actor) throw SIGNED_OUT();
        const body = request.body;
        if (!Buffer.isBuffer(body)) throw UNSUPPORTED();

        // Housekeeping: a failed sweep never refuses an upload.
        try {
          await images.sweepPending();
        } catch (error) {
          logFault(
            request.log.error.bind(request.log),
            error,
            "picture sweep failed",
          );
        }
        // Before any decode, so a client over its quota costs no CPU.
        await images.checkAllowance(actor);
        const processed = await queue.run(() => processor(body));
        const saved = await images.savePending(actor, processed);
        return reply
          .code(201)
          .header("cache-control", "no-store")
          .send({
            image: { id: saved.id, width: saved.width, height: saved.height },
          });
      },
    );

    const readLimit = {
      rateLimit: deps.readRateLimit ?? { max: 300, timeWindow: "1 minute" },
    };
    for (const variant of ["display", "thumb"] as const)
      scope.get(
        `/api/poll-images/:id/${variant}.webp`,
        { config: readLimit },
        (request, reply) => serve(deps.images, variant, request, reply),
      );
  });
}

async function serve(
  images: ImageStore | undefined,
  variant: Variant,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const id = (request.params as { id: string }).id;
  // A UUID before any query; anything else is the one 404.
  if (images === undefined || !IMAGE_ID.test(id))
    return reply.code(404).send(NOT_FOUND);
  const found = await images.servable(id, variant);
  if (!found) return reply.code(404).send(NOT_FOUND);

  const etag = `"${found.sha256}"`;
  reply
    .header("etag", etag)
    .header("cache-control", "public, max-age=3600")
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'")
    .header("cross-origin-resource-policy", "same-origin");
  if (notModified(request.headers["if-none-match"], etag))
    return reply.code(304).send();
  // The server produced these bytes, so it names their type.
  return reply.type("image/webp").send(found.bytes);
}

/** `If-None-Match` names this ETag (weak comparison, as RFC 9110 says). */
function notModified(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/** The declared type is one of the three, with or without parameters. */
function declaredUpload(request: FastifyRequest): boolean {
  const header = request.headers["content-type"];
  if (typeof header !== "string") return false;
  const type = (header.split(";")[0] ?? "").trim().toLowerCase();
  return (UPLOAD_TYPES as readonly string[]).includes(type);
}

function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  const refusal = classify(error);
  if (refusal.status === 500)
    logFault(
      request.log.error.bind(request.log),
      error,
      "picture request failed",
    );
  if (
    error instanceof ImageStoreError &&
    error.code === "upload_limit" &&
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
  if (error instanceof ImageRefusal) return fromImageRefusal(error);
  if (error instanceof ImageStoreError) return fromStoreError(error);
  if (isStorageUnavailable(error)) return UNAVAILABLE();
  const status = (error as Partial<FastifyError>).statusCode;
  if (status === 413)
    return new Refusal(
      413,
      "image_too_large",
      "That picture is over 10 MB. Choose a smaller one.",
    );
  if (status === 429)
    return new Refusal(
      429,
      "too_many_requests",
      "Too many tries just now. Try again a little later.",
    );
  if (status === 415) return UNSUPPORTED();
  if (typeof status === "number" && status >= 400 && status < 500)
    return new Refusal(400, "bad_request", "That request could not be read.");
  return new Refusal(500, "server_error", "Something went wrong. Try again.");
}
