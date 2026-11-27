import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import type { InjectOptions } from "fastify";
import type { Pool } from "pg";
import sharp from "sharp";
import { PURPOSE_VERSION } from "../src/authoring/input.js";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import { InMemoryContributionsStore } from "../src/contributions/memory-store.js";
import { PostgresContributionsStore } from "../src/contributions/pg-store.js";
import { InMemoryMemberProfileStore } from "../src/profiles/memory-store.js";
import { createServer, type ServerDeps } from "../src/http/server.js";
import { cookieNames, SessionSigner } from "../src/http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
  type VoterStore,
} from "../src/identity/store.js";
import { MAX_UPLOAD_BYTES } from "../src/images/limits.js";
import { PostgresImageStore } from "../src/images/pg-store.js";
import { DecodeQueue, processImage } from "../src/images/process.js";
import {
  ImageStoreError,
  InMemoryImageStore,
  memoryImageDatabase,
  type ImageStore,
} from "../src/images/store.js";
import { SERVED_LOGGER } from "../src/main.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { atBarrier } from "./support/barrier.js";
import {
  detailSchema,
  mutationSchema,
  pageSchema,
  project,
  summarySchema,
} from "./support/contributions-http.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
import {
  LEAKY_MAKE,
  LEAKY_XMP,
  animatedPng,
  animatedWebp,
  avif,
  gif,
  heic,
  jpegWithMetadata,
  picture,
  pngClaimingSize,
  svg,
} from "./support/images.js";

const SESSION_COOKIE = cookieNames(false).session;
const SECRET = "test-secret-that-is-long-enough-x";
const ORIGIN = "https://pulse.example.org";
const START = new Date("2026-11-12T12:00:00.000Z");
const DAY_S = 24 * 3600;

const ACCOUNTS = {
  member: {
    id: "acct-member-91c2",
    email: "member@campus.test",
    community: "campus",
  },
  other: {
    id: "acct-other-44d0",
    email: "other@campus.test",
    community: "campus",
  },
} as const;
type Who = keyof typeof ACCOUNTS;
type Kind = "memory" | "postgres";

interface Reply {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  rawPayload: Buffer;
  json(): Record<string, unknown> & {
    error?: string;
    message?: string;
    image?: { id: string; width: number; height: number };
    poll?: Record<string, unknown> & { id: string; image: unknown };
  };
}

interface Harness {
  pool: Pool | undefined;
  request(options: InjectOptions): Promise<Reply>;
  cookie(who: Who): string;
  images: ImageStore;
  seen: string[];
  logs: string[];
  after(seconds: number): void;
  upload(
    who: Who | undefined,
    bytes: Buffer,
    options?: { type?: string | null; origin?: string | null },
  ): Promise<Reply>;
  publish(who: Who, image?: unknown): Promise<Reply>;
  get(url: string, headers?: Record<string, string>): Promise<Reply>;
  /** The stored bytes of both variants, read straight from the store's tables. */
  stored(id: string): Promise<Buffer[]>;
}

async function harness(
  t: TestContext,
  kind: Kind,
  overrides: Omit<Partial<ServerDeps>, "images"> & {
    images?: ImageStore | null;
  } = {},
): Promise<Harness> {
  let now = START;
  const clock = () => now;
  const pool = kind === "postgres" ? await migratedSchema(t) : undefined;
  if (pool)
    await pool.query(
      "insert into community (id, label) values ('campus', 'Campus')",
    );
  const voters: VoterStore = pool
    ? new PostgresVoterStore(pool)
    : new InMemoryVoterStore();
  const votes = pool
    ? new PostgresVotingStore(pool, clock)
    : new InMemoryVotingStore(clock);
  for (const account of Object.values(ACCOUNTS))
    await voters.create(
      {
        id: account.id,
        community: account.community,
        assurance: "email",
        claimedAt: START,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: account.email, verifiedAt: START },
    );
  const creation = pool
    ? new PostgresCreationStore(pool, { clock })
    : new InMemoryCreationStore(
        voters as InMemoryVoterStore,
        votes as InMemoryVotingStore,
        {
          clock,
          ownerEmail: ACCOUNTS.other.email,
          communityLabels: new Map([["campus", "Campus"]]),
        },
      );
  const defaultImages: ImageStore = pool
    ? new PostgresImageStore(pool, { clock })
    : new InMemoryImageStore(
        voters as InMemoryVoterStore,
        votes as InMemoryVotingStore,
        { clock },
      );
  const images =
    overrides.images === null ? undefined : (overrides.images ?? defaultImages);
  const signer = new SessionSigner(SECRET, { ttlSeconds: 3600, clock });
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const { images: _images, ...rest } = overrides;
  void _images;
  const app = await createServer({
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `${ORIGIN}/sign-in?token=${token}`,
    }),
    voters,
    votes,
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    secureCookies: false,
    webOrigin: ORIGIN,
    creation,
    contributions: pool
      ? new PostgresContributionsStore(pool, clock)
      : new InMemoryContributionsStore(
          voters as InMemoryVoterStore,
          votes as InMemoryVotingStore,
          { clock },
        ),
    ...(!pool
      ? {
          profiles: new InMemoryMemberProfileStore(
            voters as InMemoryVoterStore,
            { clock },
          ),
        }
      : {}),
    logger: { ...SERVED_LOGGER, level: "info", stream },
    ...(images === undefined ? {} : { images }),
    // Tests send more than ten uploads; the limit itself has its own test.
    uploadRateLimit: { max: 1000, timeWindow: "1 minute" },
    ...rest,
  });
  t.after(() => app.close());

  const seen: string[] = [];
  const send = async (request: InjectOptions): Promise<Reply> => {
    const response = await app.inject(request);
    seen.push(response.body, JSON.stringify(response.headers));
    return response as unknown as Reply;
  };
  const cookie = (who: Who) =>
    `${SESSION_COOKIE}=${signer.sign(ACCOUNTS[who].id, 0)}`;

  return {
    pool,
    request: send,
    cookie,
    images: defaultImages,
    seen,
    logs,
    after(seconds) {
      now = new Date(now.getTime() + seconds * 1000);
    },
    upload(who, bytes, options = {}) {
      return send({
        method: "POST",
        url: "/api/poll-images",
        headers: {
          ...(who === undefined ? {} : { cookie: cookie(who) }),
          ...(options.origin === null
            ? {}
            : { origin: options.origin ?? ORIGIN }),
          ...(options.type === null
            ? {}
            : { "content-type": options.type ?? "image/jpeg" }),
        },
        payload: bytes,
      });
    },
    publish(who, image) {
      return send({
        method: "POST",
        url: "/api/polls",
        headers: {
          cookie: cookie(who),
          origin: ORIGIN,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        payload: JSON.stringify({
          question: "Plant a garden?",
          choices: ["Yes", "No"],
          method: "single",
          purposeAcknowledgement: PURPOSE_VERSION,
          ...(image === undefined ? {} : { image }),
        }),
      });
    },
    get(url, headers = {}) {
      return send({ method: "GET", url, headers });
    },
    async stored(id) {
      if (pool) {
        const { rows } = await pool.query<{ bytes: Buffer }>(
          "select bytes from image_bytes where image_id = $1 order by variant",
          [id],
        );
        return rows.map((row) => row.bytes);
      }
      const image = memoryImageDatabase(
        votes as InMemoryVotingStore,
      ).images.get(id);
      return image
        ? [image.variants.display.bytes, image.variants.thumb.bytes]
        : [];
    },
  };
}

function refused(
  reply: Reply,
  status: number,
  error: string,
  message?: string,
): void {
  assert.equal(reply.statusCode, status, reply.body);
  const body = reply.json();
  assert.equal(body.error, error);
  assert.equal(typeof body.message, "string");
  assert.ok((body.message as string).length > 0);
  if (message !== undefined) assert.equal(body.message, message);
  assert.equal(reply.headers["cache-control"], "no-store");
}

function postContribution(h: Harness, image?: unknown, key = randomUUID()) {
  return h.request({
    method: "POST",
    url: "/api/contributions",
    headers: {
      origin: ORIGIN,
      cookie: h.cookie("member"),
      "content-type": "application/json",
      "idempotency-key": key,
    },
    payload: {
      ...project,
      accountId: ACCOUNTS.member.id,
      ...(image === undefined ? {} : { image }),
    },
  });
}

function manageContributionPicture(
  h: Harness,
  method: "PUT" | "DELETE",
  url: string,
  who: Who | undefined,
  payload?: unknown,
  origin = ORIGIN,
) {
  return h.request({
    method,
    url,
    headers: {
      origin,
      ...(who ? { cookie: h.cookie(who) } : {}),
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "PUT" ? { payload: JSON.stringify(payload) } : {}),
  });
}

async function pendingPicture(h: Harness) {
  const uploaded = await h.upload("member", await picture("jpeg"));
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  assert.ok(uploaded.json().image);
  return { id: uploaded.json().image!.id, alt: "Garden beds" };
}

test("contribution picture appears in the creation, detail, and listing contracts", async (t) => {
  const h = await harness(t, "memory");
  const noPicture = await postContribution(h);
  assert.equal(noPicture.statusCode, 201, noPicture.body);
  assert.deepEqual(mutationSchema.parse(noPicture.json()).contribution.image, {
    kind: "tile",
  });

  const pending = await pendingPicture(h);
  const created = await postContribution(h, {
    ...pending,
    alt: "  Garden beds  ",
  });
  assert.equal(created.statusCode, 201, created.body);
  const { contribution } = mutationSchema.parse(created.json());
  const { id, image } = contribution;
  assert.deepEqual(image, {
    kind: "upload",
    displayUrl: `/api/poll-images/${pending.id}/display.webp`,
    thumbUrl: `/api/poll-images/${pending.id}/thumb.webp`,
    width: 400,
    height: 300,
    alt: pending.alt,
  });
  if (image.kind !== "upload") throw new Error("expected upload");
  for (const url of [image.displayUrl, image.thumbUrl]) {
    const result = await h.get(url);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.headers["content-type"], "image/webp");
  }
  const path = `/api/contributions/${id}`;
  for (const who of [undefined, "other", "member"] as const) {
    const read = await h.get(path, who ? { cookie: h.cookie(who) } : {});
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.deepEqual(detailSchema.parse(read.json()), {
      contribution,
      canManage: who === "member",
    });
  }
  const profile = await h.request({
    method: "PUT",
    url: "/api/me/profile",
    headers: {
      cookie: h.cookie("member"),
      origin: ORIGIN,
      "content-type": "application/json",
    },
    payload: {
      ownerAccountId: ACCOUNTS.member.id,
      displayName: "Gardener",
      bio: "",
      visible: true,
    },
  });
  assert.equal(profile.statusCode, 200, profile.body);
  const {
    profile: { publicId },
  } = profile.json() as { profile: { publicId: string } };
  for (const url of [
    "/api/contributions",
    "/api/me/contributions",
    `/api/profiles/${publicId}/contributions`,
  ]) {
    const list = await h.get(url, { cookie: h.cookie("member") });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(
      pageSchema.parse(list.json()).contributions.find((row) => row.id === id)
        ?.image,
      image,
    );
  }
});

for (const kind of ["memory", "postgres"] as const) {
  test(
    `${kind}: a pending picture is consumed only once across polls and contributions`,
    { skip: kind === "postgres" ? databaseSkip : false },
    async (t) => {
      const h = await harness(t, kind);
      refused(
        await postContribution(h, { id: randomUUID(), alt: "Missing picture" }),
        422,
        "image_unavailable",
      );
      const forPoll = await pendingPicture(h);
      refused(
        await postContribution(h, { ...forPoll, alt: " " }),
        400,
        "bad_request",
        "Check the fields and try again. Commercial offers need at least 20% savings.",
      );
      assert.equal((await h.publish("member", forPoll)).statusCode, 201);
      refused(await postContribution(h, forPoll), 422, "image_unavailable");
      const forContribution = await pendingPicture(h);
      assert.equal(
        (await postContribution(h, forContribution)).statusCode,
        201,
      );
      refused(
        await h.publish("member", forContribution),
        422,
        "image_unavailable",
      );
    },
  );
}

test("only the contribution poster can replace or remove its picture", async (t) => {
  const h = await harness(t, "memory");
  const initial = await pendingPicture(h);
  const key = randomUUID();
  const created = await postContribution(h, initial, key);
  assert.equal(created.statusCode, 201, created.body);
  const {
    contribution: { id, image },
  } = mutationSchema.parse(created.json());
  if (image.kind !== "upload") throw new Error("expected upload");
  const replacement = await pendingPicture(h);
  const path = `/api/contributions/${id}/image`;
  function manage(
    method: "PUT" | "DELETE",
    who?: Who,
    url = path,
    origin = ORIGIN,
    payload: unknown = replacement,
  ) {
    return manageContributionPicture(h, method, url, who, payload, origin);
  }
  for (const method of ["PUT", "DELETE"] as const) {
    refused(
      await manage(method),
      401,
      "signed_out",
      "Sign in to change this picture.",
    );
    // "other" is configured as site owner, but does not own this contribution.
    refused(await manage(method, "other"), 403, "organizer_required");
    refused(
      await manage(method, "other", `/api/contributions/${randomUUID()}/image`),
      404,
      "not_found",
    );
    refused(
      await manage(method, "member", path, "https://foreign.example"),
      403,
      "origin_not_allowed",
    );
  }
  refused(
    await manage("PUT", "member", path, ORIGIN, {
      ...replacement,
      alt: "a".repeat(32 * 1024),
    }),
    413,
    "body_too_large",
  );
  const badPictureMessage =
    "Check the picture and its description, then try again.";
  for (const payload of [
    { ...replacement, alt: "" },
    { ...replacement, alt: "\u0000" },
    { ...replacement, unexpected: true },
  ]) {
    refused(
      await manage("PUT", "member", path, ORIGIN, payload),
      400,
      "bad_request",
      badPictureMessage,
    );
  }
  refused(
    await h.request({
      method: "PUT",
      url: path,
      headers: { origin: ORIGIN, cookie: h.cookie("member") },
    }),
    400,
    "bad_request",
    badPictureMessage,
  );
  refused(
    await manage("PUT", "member", path, ORIGIN, {
      id: randomUUID(),
      alt: "Missing",
    }),
    422,
    "image_unavailable",
  );
  assert.equal((await h.get(image.displayUrl)).statusCode, 200);

  const pictureResponse = summarySchema.pick({ image: true });
  const replaced = await manage("PUT", "member");
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal(replaced.headers["cache-control"], "no-store");
  const next = pictureResponse.parse(replaced.json()).image;
  if (next.kind !== "upload") throw new Error("expected replacement");
  assert.equal(
    next.displayUrl,
    `/api/poll-images/${replacement.id}/display.webp`,
  );
  assert.equal((await h.get(image.displayUrl)).statusCode, 404);
  assert.equal((await h.get(next.displayUrl)).statusCode, 200);

  const removed = await manage("DELETE", "member");
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.headers["cache-control"], "no-store");
  assert.deepEqual(pictureResponse.parse(removed.json()).image, {
    kind: "tile",
  });
  assert.equal((await h.get(next.thumbUrl)).statusCode, 404);
  const replay = await postContribution(h, initial, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(mutationSchema.parse(replay.json()).contribution.image, {
    kind: "tile",
  });
});

test(
  "postgres: replacing a contribution picture erases its description from the creation retry record",
  { skip: databaseSkip },
  async (t) => {
    const h = await harness(t, "postgres");
    const pool = h.pool as Pool;
    const initial = {
      ...(await pendingPicture(h)),
      alt: "Original garden beds",
    };
    const key = randomUUID();
    const created = await postContribution(h, initial, key);
    assert.equal(created.statusCode, 201, created.body);
    const {
      contribution: { id },
    } = mutationSchema.parse(created.json());
    const replacement = {
      ...(await pendingPicture(h)),
      alt: "New garden beds",
    };
    const replaced = await h.request({
      method: "PUT",
      url: `/api/contributions/${id}/image`,
      headers: {
        cookie: h.cookie("member"),
        origin: ORIGIN,
        "content-type": "application/json",
      },
      payload: replacement,
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    const { rows } = await pool.query<{ canonical: string }>(
      "select canonical from contribution_replay where voter_id = $1 and request_key = $2",
      [ACCOUNTS.member.id, key],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.canonical.includes(initial.alt), false);
    const replayed = await postContribution(
      h,
      { ...initial, alt: ` ${initial.alt} ` },
      key,
    );
    assert.equal(replayed.statusCode, 200, replayed.body);
    const replay = mutationSchema.parse(replayed.json());
    assert.equal(replay.replayed, true);
    assert.equal(replay.contribution.id, id);
    assert.deepEqual(
      replay.contribution.image,
      summarySchema.pick({ image: true }).parse(replaced.json()).image,
    );
    refused(
      await postContribution(h, { ...initial, alt: replacement.alt }, key),
      409,
      "idempotency_conflict",
    );
  },
);

test("contribution picture management limits each method to 30 requests per minute", async (t) => {
  const h = await harness(t, "memory");
  const url = `/api/contributions/${randomUUID()}/image`;
  const pending = await pendingPicture(h);
  for (const method of ["PUT", "DELETE"] as const) {
    const request = () =>
      manageContributionPicture(h, method, url, "member", pending);
    for (let index = 0; index < 30; index++) {
      refused(await request(), 404, "not_found");
    }
    refused(await request(), 429, "too_many_requests");
  }
});

for (const [sqlstate, status, error] of [
  ["53000", 503, "contributions_unavailable"],
  ["P0001", 500, "server_error"],
] as const) {
  test(
    `postgres: contribution picture management rolls back on ${error} during audit`,
    { skip: databaseSkip },
    async (t) => {
      const h = await harness(t, "postgres");
      const pool = h.pool as Pool;
      const initial = await pendingPicture(h);
      const created = await postContribution(h, initial);
      assert.equal(created.statusCode, 201, created.body);
      const { contribution } = mutationSchema.parse(created.json());
      const replacement = await pendingPicture(h);
      await pool.query(
        `create function fail_picture_audit() returns trigger language plpgsql as $$ begin raise exception 'private audit detail' using errcode = '${sqlstate}'; end $$`,
      );
      await pool.query(
        "create trigger fail_picture_audit before insert on content_change for each row execute function fail_picture_audit()",
      );
      const url = `/api/contributions/${contribution.id}/image`;
      for (const method of ["PUT", "DELETE"] as const) {
        const reply = await manageContributionPicture(
          h,
          method,
          url,
          "member",
          replacement,
        );
        refused(reply, status, error);
        assert.equal(reply.body.includes("private audit detail"), false);
        const detail = await h.get(`/api/contributions/${contribution.id}`);
        assert.equal(detail.statusCode, 200, detail.body);
        assert.deepEqual(
          detailSchema.parse(detail.json()).contribution.image,
          contribution.image,
        );
        assert.equal(
          (await h.get(`/api/poll-images/${initial.id}/display.webp`))
            .statusCode,
          200,
        );
        assert.deepEqual(
          (
            await pool.query(
              "select owner_kind, owner_id, alt from image where id = $1",
              [replacement.id],
            )
          ).rows,
          [{ owner_kind: null, owner_id: null, alt: null }],
        );
      }
      await pool.query("drop trigger fail_picture_audit on content_change");
      const retried = await manageContributionPicture(
        h,
        "PUT",
        url,
        "member",
        replacement,
      );
      assert.equal(retried.statusCode, 200, retried.body);
    },
  );
}

/** Upload a picture, attach it to a new poll, and return both ids. */
async function posted(h: Harness, bytes?: Buffer) {
  const up = await h.upload("member", bytes ?? (await picture("jpeg")));
  assert.equal(up.statusCode, 201, up.body);
  const id = up.json().image?.id as string;
  const published = await h.publish("member", { id, alt: "A sunny plot" });
  assert.equal(published.statusCode, 201, published.body);
  return { id, pollId: published.json().poll?.id as string };
}

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

for (const kind of ["memory", "postgres"] as const) {
  const skip = kind === "postgres" ? databaseSkip : false;
  const it = (name: string, body: (t: TestContext) => Promise<void>) =>
    test(`${kind}: ${name}`, { skip }, body);

  it("an_upload_answers_201_with_only_its_id_and_display_size", async (t) => {
    const h = await harness(t, kind);
    const reply = await h.upload("member", await picture("jpeg", 2000, 1000));
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal(reply.headers["cache-control"], "no-store");
    assert.deepEqual(Object.keys(reply.json()), ["image"]);
    const image = reply.json().image;
    assert.ok(image);
    assert.deepEqual(Object.keys(image).sort(), ["height", "id", "width"]);
    assert.match(
      image.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.deepEqual([image.width, image.height], [1600, 800]);
    assert.equal(reply.headers["set-cookie"], undefined);
  });

  it("a_mislabelled_file_is_judged_by_its_content", async (t) => {
    const h = await harness(t, kind);
    // PNG bytes declared as JPEG, WebP bytes declared as PNG: accepted.
    assert.equal(
      (await h.upload("member", await picture("png"), { type: "image/jpeg" }))
        .statusCode,
      201,
    );
    assert.equal(
      (await h.upload("member", await picture("webp"), { type: "image/png" }))
        .statusCode,
      201,
    );
    // GIF and SVG bytes under an accepted type: refused by their content.
    refused(
      await h.upload("member", await gif(), { type: "image/png" }),
      415,
      "unsupported_image",
    );
    refused(
      await h.upload("member", svg(), { type: "image/webp" }),
      415,
      "unsupported_image",
    );
  });

  it("each_unsupported_file_is_refused_and_nothing_is_kept", async (t) => {
    const h = await harness(t, kind);
    for (const bytes of [
      svg(),
      await gif(),
      heic(),
      await avif(),
      await animatedPng(),
      await animatedWebp(),
      Buffer.from("not a picture"),
    ])
      refused(
        await h.upload("member", bytes, { type: "image/png" }),
        415,
        "unsupported_image",
      );
    // A declared type outside the three, or none, is refused before reading.
    refused(
      await h.upload("member", await picture("jpeg"), { type: "image/gif" }),
      415,
      "unsupported_image",
    );
    refused(
      await h.upload("member", await picture("jpeg"), {
        type: "image/svg+xml",
      }),
      415,
      "unsupported_image",
    );
    refused(
      await h.upload("member", await picture("jpeg"), { type: null }),
      415,
      "unsupported_image",
    );
    refused(
      await h.upload("member", await picture("jpeg"), {
        type: "application/octet-stream",
      }),
      415,
      "unsupported_image",
    );
    // None of those took one of the five pending slots.
    for (let n = 0; n < 5; n++)
      assert.equal(
        (await h.upload("member", await picture("jpeg"))).statusCode,
        201,
      );
  });

  it("a_body_over_10_MiB_is_refused_and_10_MiB_itself_is_read", async (t) => {
    const h = await harness(t, kind);
    refused(
      await h.upload("member", Buffer.alloc(MAX_UPLOAD_BYTES + 1)),
      413,
      "image_too_large",
    );
    // Exactly the limit is read and then judged by its content.
    const atLimit = Buffer.alloc(MAX_UPLOAD_BYTES);
    atLimit.set([0xff, 0xd8, 0xff]);
    refused(await h.upload("member", atLimit), 415, "unsupported_image");
  });

  it("pictures_outside_the_pixel_limits_are_refused_by_their_own_error", async (t) => {
    const h = await harness(t, kind);
    for (const bytes of [
      pngClaimingSize(8001, 300),
      pngClaimingSize(7000, 6000),
      await picture("png", 199, 400),
    ])
      refused(
        await h.upload("member", bytes, { type: "image/png" }),
        422,
        "image_dimensions",
      );
  });

  it("signed_out_foreign_origin_and_no_store_are_refused_before_the_api_reads_the_body", async (t) => {
    const h = await harness(t, kind);
    // An oversized body would be 413 if it were read; these never read it.
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    refused(await h.upload(undefined, huge), 401, "signed_out");
    refused(
      await h.upload("member", huge, { origin: "https://evil.example" }),
      403,
      "origin_not_allowed",
    );
    refused(
      await h.upload("member", huge, { origin: null }),
      403,
      "origin_not_allowed",
    );
    const off = await harness(t, kind, { images: null });
    refused(await off.upload("member", huge), 503, "images_unavailable");
  });

  it("the_stored_variants_carry_no_exif_gps_xmp_or_icc", async (t) => {
    const h = await harness(t, kind);
    const { id } = await posted(h, await jpegWithMetadata());
    const stored = await h.stored(id);
    assert.equal(stored.length, 2);
    const served = [
      (await h.get(`/api/poll-images/${id}/display.webp`)).rawPayload,
      (await h.get(`/api/poll-images/${id}/thumb.webp`)).rawPayload,
    ];
    for (const bytes of [...stored, ...served]) {
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.exif, undefined);
      assert.equal(meta.xmp, undefined);
      assert.equal(meta.icc, undefined);
      assert.equal(bytes.includes("Exif"), false);
      assert.equal(bytes.includes(LEAKY_MAKE), false);
      assert.equal(bytes.includes(LEAKY_XMP), false);
    }
    // Served bytes are exactly what was stored.
    assert.ok(served[0]?.equals(stored[0] as Buffer));
    assert.ok(served[1]?.equals(stored[1] as Buffer));
  });

  it("a_served_picture_carries_the_ADR_headers_and_a_strong_sha256_etag", async (t) => {
    const h = await harness(t, kind);
    const { id } = await posted(h);
    for (const variant of ["display", "thumb"]) {
      const reply = await h.get(`/api/poll-images/${id}/${variant}.webp`);
      assert.equal(reply.statusCode, 200);
      assert.equal(reply.headers["content-type"], "image/webp");
      assert.equal(reply.headers["x-content-type-options"], "nosniff");
      assert.equal(
        reply.headers["content-security-policy"],
        "default-src 'none'",
      );
      assert.equal(
        reply.headers["cross-origin-resource-policy"],
        "same-origin",
      );
      assert.equal(reply.headers["cache-control"], "public, max-age=3600");
      assert.equal(reply.headers.etag, `"${sha256(reply.rawPayload)}"`);
      assert.equal(reply.headers["set-cookie"], undefined);

      const etag = reply.headers.etag as string;
      const same = await h.get(`/api/poll-images/${id}/${variant}.webp`, {
        "if-none-match": etag,
      });
      assert.equal(same.statusCode, 304);
      assert.equal(same.rawPayload.length, 0);
      assert.equal(same.headers.etag, etag);
      assert.equal(same.headers["cache-control"], "public, max-age=3600");
      const weak = await h.get(`/api/poll-images/${id}/${variant}.webp`, {
        "if-none-match": `"other", W/${etag}`,
      });
      assert.equal(weak.statusCode, 304);
      const changed = await h.get(`/api/poll-images/${id}/${variant}.webp`, {
        "if-none-match": '"0000"',
      });
      assert.equal(changed.statusCode, 200);
    }
    const display = await h.get(`/api/poll-images/${id}/display.webp`);
    const thumb = await h.get(`/api/poll-images/${id}/thumb.webp`);
    assert.notEqual(display.headers.etag, thumb.headers.etag);
    const meta = await sharp(thumb.rawPayload).metadata();
    assert.deepEqual([meta.width, meta.height], [256, 256]);
  });

  it("every_refused_picture_is_the_same_404_as_an_unknown_path", async (t) => {
    const h = await harness(t, kind);
    const { id: attached } = await posted(h);
    const pending = (await h.upload("member", await picture("jpeg"))).json()
      .image?.id as string;
    const others = (await h.upload("other", await picture("jpeg"))).json().image
      ?.id as string;
    const urls = [
      "/api/nothing-here",
      `/api/poll-images/${randomUUID()}/display.webp`,
      `/api/poll-images/${pending}/display.webp`,
      `/api/poll-images/${pending}/thumb.webp`,
      `/api/poll-images/${others}/thumb.webp`,
      `/api/poll-images/${attached.toUpperCase()}/display.webp`,
      `/api/poll-images/${attached}/original.jpg`,
      `/api/poll-images/${attached}`,
      "/api/poll-images/not-a-uuid/display.webp",
      `/api/poll-images/${attached}x/display.webp`,
      "/api/poll-images/'%3B%20drop%20table%20image/thumb.webp",
    ];
    const baseline = await h.get(urls[0] as string);
    assert.equal(baseline.statusCode, 404);
    for (const url of urls) {
      const reply = await h.get(url);
      assert.equal(reply.statusCode, 404, url);
      assert.equal(reply.body, baseline.body, url);
      assert.equal(
        reply.headers["content-type"],
        baseline.headers["content-type"],
        url,
      );
      for (const header of ["etag", "cache-control", "set-cookie"])
        assert.equal(reply.headers[header], undefined, `${url} ${header}`);
    }
    if (kind === "postgres") {
      // A hidden poll's picture is the same 404 too.
      const { id, pollId } = await posted(h);
      await h.pool?.query("update polls set hidden = true where id = $1", [
        pollId,
      ]);
      const reply = await h.get(`/api/poll-images/${id}/display.webp`);
      assert.equal(reply.statusCode, 404);
      assert.equal(reply.body, baseline.body);
      assert.deepEqual((await h.get(`/api/polls/${pollId}`)).json().image, {
        kind: "tile",
      });
    }
  });

  it("the_poll_body_listing_and_creation_answer_name_the_picture_without_its_uploader", async (t) => {
    const h = await harness(t, kind);
    const up = await h.upload("member", await picture("png", 900, 600), {
      type: "image/png",
    });
    const id = up.json().image?.id as string;
    const published = await h.publish("member", {
      id,
      alt: "  A sunny plot  ",
    });
    assert.equal(published.statusCode, 201, published.body);
    const expected = {
      kind: "upload",
      displayUrl: `/api/poll-images/${id}/display.webp`,
      thumbUrl: `/api/poll-images/${id}/thumb.webp`,
      width: 900,
      height: 600,
      alt: "A sunny plot",
    };
    assert.deepEqual(published.json().poll?.image, expected);
    const pollId = published.json().poll?.id as string;
    assert.deepEqual(
      (await h.get(`/api/polls/${pollId}`)).json().image,
      expected,
    );
    const listing = (
      await h.get("/api/polls?community=campus")
    ).json() as unknown as {
      polls: { id: string; image: unknown }[];
    };
    assert.deepEqual(
      listing.polls.find((p) => p.id === pollId)?.image,
      expected,
    );
    // A poll without a picture reads as the tile.
    const plain = await h.publish("member");
    assert.deepEqual(plain.json().poll?.image, { kind: "tile" });
    // Nothing anywhere names the uploader.
    for (const text of [...h.seen, ...h.logs])
      assert.doesNotMatch(text, /acct-member|acct-other|campus\.test/);
  });

  it("attaching_refuses_a_picture_that_is_not_the_callers_pending_one", async (t) => {
    const h = await harness(t, kind);
    const others = (await h.upload("other", await picture("jpeg"))).json().image
      ?.id as string;
    refused(
      await h.publish("member", { id: others, alt: "x" }),
      422,
      "image_unavailable",
    );
    refused(
      await h.publish("member", { id: randomUUID(), alt: "x" }),
      422,
      "image_unavailable",
    );
    const { id } = await posted(h);
    refused(
      await h.publish("member", { id, alt: "again" }),
      422,
      "image_unavailable",
    );
    const mine = (await h.upload("member", await picture("jpeg"))).json().image
      ?.id as string;
    for (const image of [
      { id: mine },
      { id: mine, alt: "" },
      { id: mine, alt: "   " },
      { id: mine, alt: "a".repeat(301) },
      { id: mine, alt: "x\u0000y" },
      { id: mine.toUpperCase(), alt: "x" },
      { id: "not-a-uuid", alt: "x" },
      { id: mine, alt: "x", extra: true },
      null,
      mine,
    ])
      refused(await h.publish("member", image), 400, "bad_request");
    // 300 code points, most of them astral, is allowed.
    const ok = await h.publish("member", {
      id: mine,
      alt: "🌱".repeat(299) + "a",
    });
    assert.equal(ok.statusCode, 201, ok.body);
  });

  it("pending_pictures_are_swept_after_24_hours_on_the_next_upload", async (t) => {
    const h = await harness(t, kind);
    const first = (await h.upload("member", await picture("jpeg"))).json().image
      ?.id as string;
    h.after(DAY_S);
    assert.equal(
      (await h.upload("member", await picture("jpeg"))).statusCode,
      201,
    );
    assert.deepEqual(await h.stored(first), []);
    refused(
      await h.publish("member", { id: first, alt: "x" }),
      422,
      "image_unavailable",
    );
  });

  it("a_sixth_pending_picture_is_refused_before_it_is_decoded", async (t) => {
    let decoded = 0;
    const h = await harness(t, kind, {
      imageProcessor: async (input) => {
        decoded++;
        return processImage(input);
      },
    });
    for (let n = 0; n < 5; n++)
      assert.equal(
        (await h.upload("member", await picture("jpeg"))).statusCode,
        201,
      );
    assert.equal(decoded, 5);
    refused(
      await h.upload("member", await picture("jpeg")),
      429,
      "pending_limit",
    );
    assert.equal(decoded, 5);
  });
}

test(
  "postgres: two concurrent publications attaching one picture: one wins, one is refused",
  { skip: databaseSkip },
  async (t) => {
    const h = await harness(t, "postgres");
    const pool = h.pool as Pool;
    const id = (await h.upload("member", await picture("jpeg"))).json().image
      ?.id as string;
    // Both publications must be waiting at the account row before either may
    // run, so they provably overlap when they reach the picture.
    const replies = await atBarrier(
      pool,
      "select 1 from voter where id = $1 for update",
      [ACCOUNTS.member.id],
      2,
      () =>
        Promise.all([
          h.publish("member", { id, alt: "first" }),
          h.publish("member", { id, alt: "second" }),
        ]),
    );
    assert.deepEqual(replies.map((r) => r.statusCode).sort(), [201, 422]);
    const loser = replies.find((r) => r.statusCode === 422) as Reply;
    refused(loser, 422, "image_unavailable");
    const linked = await pool.query(
      "select count(*)::int as n from polls where image_id = $1",
      [id],
    );
    assert.equal(linked.rows[0]?.n, 1);
    const audit = await pool.query(
      "select count(*)::int as n from content_change where image_id = $1",
      [id],
    );
    assert.equal(audit.rows[0]?.n, 1);
  },
);

test(
  "postgres: a concurrent poll and contribution cannot both claim the same pending picture",
  { skip: databaseSkip },
  async (t) => {
    const h = await harness(t, "postgres");
    const pool = h.pool as Pool;
    const pending = await pendingPicture(h);
    const [poll, contribution] = await atBarrier(
      pool,
      "select 1 from voter where id = $1 for update",
      [ACCOUNTS.member.id],
      2,
      () =>
        Promise.all([
          h.publish("member", pending),
          postContribution(h, pending),
        ]),
    );
    assert.deepEqual(
      [poll.statusCode, contribution.statusCode].sort(),
      [201, 422],
    );
    const expectedOwner =
      poll.statusCode === 201
        ? { kind: "poll", id: poll.json().poll!.id }
        : {
            kind: "contribution",
            id: mutationSchema.parse(contribution.json()).contribution.id,
          };
    refused(
      poll.statusCode === 422 ? poll : contribution,
      422,
      "image_unavailable",
    );
    const links = await pool.query(
      "select 'poll' as kind, id::text from polls where image_id = $1 " +
        "union all select 'contribution' as kind, id::text from contribution where image_id = $1",
      [pending.id],
    );
    assert.deepEqual(links.rows, [expectedOwner]);
    const owners = await pool.query(
      "select owner_kind as kind, owner_id as id from image where id = $1",
      [pending.id],
    );
    assert.deepEqual(owners.rows, [expectedOwner]);
  },
);

test("the_hourly_upload_limit_answers_429_with_retry_after", async (t) => {
  const quota = {
    async checkAllowance() {
      throw new ImageStoreError("upload_limit", 125.2);
    },
    async savePending() {
      throw new Error("unreachable");
    },
    async servable() {
      return undefined;
    },
    async sweepPending() {
      return 0;
    },
  };
  const h = await harness(t, "memory", { images: quota });
  const reply = await h.upload("member", await picture("jpeg"));
  refused(reply, 429, "upload_limit");
  assert.equal(reply.headers["retry-after"], "126");
});

test("the_per_client_upload_rate_limit_counts_refused_requests_too", async (t) => {
  const h = await harness(t, "memory", {
    uploadRateLimit: { max: 2, timeWindow: "1 minute" },
  });
  refused(await h.upload(undefined, await picture("jpeg")), 401, "signed_out");
  assert.equal(
    (await h.upload("member", await picture("jpeg"))).statusCode,
    201,
  );
  refused(
    await h.upload("member", await picture("jpeg")),
    429,
    "too_many_requests",
  );
});

test("a_full_decode_queue_answers_503_image_busy", async (t) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(t, "memory", {
    imageQueue: new DecodeQueue(0),
    imageProcessor: async (input) => {
      started();
      await held;
      return processImage(input);
    },
  });
  const first = h.upload("member", await picture("jpeg"));
  await running;
  refused(await h.upload("other", await picture("jpeg")), 503, "image_busy");
  release();
  assert.equal((await first).statusCode, 201);
});

test("uuid_is_checked_before_the_store_is_asked_anything", async (t) => {
  let asked = 0;
  const spy: ImageStore = {
    async checkAllowance() {},
    async savePending() {
      throw new Error("unreachable");
    },
    async servable() {
      asked++;
      return undefined;
    },
    async sweepPending() {
      return 0;
    },
  };
  const h = await harness(t, "memory", { images: spy });
  for (const id of [
    "not-a-uuid",
    randomUUID().toUpperCase(),
    "1".repeat(36),
    "'or'1'='1",
  ])
    assert.equal(
      (await h.get(`/api/poll-images/${encodeURIComponent(id)}/thumb.webp`))
        .statusCode,
      404,
    );
  assert.equal(asked, 0);
  assert.equal(
    (await h.get(`/api/poll-images/${randomUUID()}/thumb.webp`)).statusCode,
    404,
  );
  assert.equal(asked, 1);
});

test("a_failed_sweep_never_refuses_an_upload_and_logs_no_detail", async (t) => {
  const voters = new InMemoryVoterStore();
  const voting = new InMemoryVotingStore(() => START);
  const real = new InMemoryImageStore(voters, voting, { clock: () => START });
  const failing: ImageStore = {
    checkAllowance: (actor) => real.checkAllowance(actor),
    savePending: (actor, image) => real.savePending(actor, image),
    servable: (id, variant) => real.servable(id, variant),
    async sweepPending() {
      throw Object.assign(new Error("secret row detail acct-member-91c2"), {
        code: "XX000",
      });
    },
  };
  // A store over its own voters: give it the account the harness signs in.
  await voters.create(
    {
      id: ACCOUNTS.member.id,
      community: "campus",
      assurance: "email",
      claimedAt: START,
      proofEmailsOptIn: false,
    },
    { kind: "email", value: ACCOUNTS.member.email, verifiedAt: START },
  );
  const h = await harness(t, "memory", { images: failing });
  assert.equal(
    (await h.upload("member", await picture("jpeg"))).statusCode,
    201,
  );
  const log = h.logs.join("\n");
  assert.match(log, /picture sweep failed/);
  assert.doesNotMatch(log, /secret row detail|acct-member/);
});

test("no_upload_body_or_picture_bytes_reach_the_log", async (t) => {
  const h = await harness(t, "memory");
  await posted(h, await jpegWithMetadata());
  const log = h.logs.join("\n");
  assert.doesNotMatch(
    log,
    new RegExp(`${LEAKY_MAKE}|${LEAKY_XMP}|acct-member|campus\\.test`),
  );
});
