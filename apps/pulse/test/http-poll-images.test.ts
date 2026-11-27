import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import type { Pool } from "pg";
import { PURPOSE_VERSION } from "../src/authoring/input.js";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import type { PollPictureStore } from "../src/authoring/poll-picture.js";
import { createServer } from "../src/http/server.js";
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
} from "../src/identity/store.js";
import { PostgresImageStore } from "../src/images/pg-store.js";
import type { PublicImage } from "../src/images/public.js";
import {
  InMemoryImageStore,
  memoryImageDatabase,
} from "../src/images/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { atBarrier } from "./support/barrier.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
import { picture } from "./support/images.js";

const ORIGIN = "https://pulse.example.org";
const START = Date.parse("2026-11-12T12:00:00.000Z");
const POSTER = { id: "private-poll-poster", email: "poster@private.test" };
const OWNER = { id: "private-site-owner", email: "owner@private.test" };
const TILE = { kind: "tile" };
type Backend = "memory" | "postgres";
type ImageRequest = {
  who?: typeof POSTER;
  origin?: string;
  input?: unknown;
  expected?: string;
};

interface AuditRow {
  action: string;
  imageId: string;
  imageSha256: string;
  actorKind: string;
  actorId: string;
}

async function harness(
  t: TestContext,
  backend: Backend,
  pictureStore: (store: PollPictureStore) => PollPictureStore | undefined = (
    store,
  ) => store,
) {
  let now = START;
  const clock = () => new Date(now);
  const pool = backend === "postgres" ? await migratedSchema(t) : undefined;
  const memoryVoters = new InMemoryVoterStore();
  const memoryVotes = new InMemoryVotingStore(clock);
  const voters = pool ? new PostgresVoterStore(pool) : memoryVoters;
  const votes = pool ? new PostgresVotingStore(pool, clock) : memoryVotes;
  const creationOptions = { clock, ownerEmail: OWNER.email };
  const creation = pool
    ? new PostgresCreationStore(pool, creationOptions)
    : new InMemoryCreationStore(memoryVoters, memoryVotes, creationOptions);
  const images = pool
    ? new PostgresImageStore(pool, { clock })
    : new InMemoryImageStore(memoryVoters, memoryVotes, { clock });
  for (const account of [POSTER, OWNER]) {
    await voters.create(
      {
        id: account.id,
        community: null,
        assurance: "email",
        claimedAt: clock(),
        proofEmailsOptIn: false,
      },
      { kind: "email", value: account.email, verifiedAt: clock() },
    );
  }
  const signer = new SessionSigner("test-secret-that-is-long-enough-x", {
    clock,
  });
  const pollPictures = pictureStore(creation);
  const app = await createServer({
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `${ORIGIN}/sign-in?token=${token}`,
    }),
    votes,
    voters,
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    secureCookies: false,
    webOrigin: ORIGIN,
    creation,
    ...(pollPictures ? { pollPictures } : {}),
    images,
  });
  t.after(() => app.close());

  const cookie = (who: typeof POSTER) =>
    `${cookieNames(false).session}=${signer.sign(who.id, 0)}`;
  const send = async (request: InjectOptions) => {
    now++;
    const reply = await app.inject(request);
    for (const account of [POSTER, OWNER]) {
      assert.ok(!reply.body.includes(account.id));
      assert.ok(!reply.body.includes(account.email));
    }
    return reply;
  };
  return {
    pool,
    send,
    async upload(who = POSTER) {
      const reply = await send({
        method: "POST",
        url: "/api/poll-images",
        headers: {
          origin: ORIGIN,
          cookie: cookie(who),
          "content-type": "image/png",
        },
        payload: await picture("png"),
      });
      assert.equal(reply.statusCode, 201, reply.body);
      return reply.json<{ image: { id: string } }>().image.id;
    },
    async publish(imageId: string) {
      const reply = await send({
        method: "POST",
        url: "/api/polls",
        headers: {
          origin: ORIGIN,
          cookie: cookie(POSTER),
          "idempotency-key": randomUUID(),
        },
        payload: {
          question: "Plant a garden?",
          choices: ["Yes", "No"],
          method: "single",
          purposeAcknowledgement: PURPOSE_VERSION,
          image: { id: imageId, alt: "The old garden" },
        },
      });
      assert.equal(reply.statusCode, 201, reply.body);
      return reply.json<{ poll: { id: string } }>().poll.id;
    },
    async edit(
      method: "GET" | "PUT" | "DELETE",
      id: string,
      options: ImageRequest = {},
    ) {
      const { who, origin = ORIGIN, input, expected } = options;
      const url = `/api/polls/${id}/image`;
      const reply = await send({
        method,
        url:
          expected === undefined ? url : `${url}?expectedImageId=${expected}`,
        headers: {
          ...(method === "GET" ? {} : { origin }),
          ...(who ? { cookie: cookie(who) } : {}),
          ...(method === "PUT" ? { "content-type": "application/json" } : {}),
        },
        ...(input === undefined ? {} : { payload: JSON.stringify(input) }),
      });
      assert.equal(reply.headers["cache-control"], "private, no-store");
      return reply;
    },
    async stored(id: string) {
      if (pool) {
        const { rows } = await pool.query<{
          metadata: boolean;
          variants: number;
        }>(
          "select exists(select 1 from image where id = $1) as metadata," +
            " (select count(*)::int from image_bytes where image_id = $1) as variants",
          [id],
        );
        return rows[0];
      }
      const image = memoryImageDatabase(memoryVotes).images.get(id);
      return {
        metadata: image !== undefined,
        variants: image ? Object.keys(image.variants).length : 0,
      };
    },
    async audit(id: string): Promise<AuditRow[]> {
      if (pool) {
        const { rows } = await pool.query<AuditRow>(
          'select action, image_id as "imageId", image_sha256 as "imageSha256",' +
            ' actor_kind as "actorKind", actor_id as "actorId" from content_change' +
            " where target_kind = 'poll' and target_id = $1 order by changed_at, id",
          [id],
        );
        return rows;
      }
      return memoryImageDatabase(memoryVotes)
        .changes.filter(
          (row) => row.targetKind === "poll" && row.targetId === id,
        )
        .map(({ action, imageId, imageSha256, actorKind, actorId }) => {
          assert.ok(imageId && imageSha256 && actorId);
          return { action, imageId, imageSha256, actorKind, actorId };
        });
    },
  };
}

function refused(reply: LightMyRequestResponse, status: number, error: string) {
  assert.equal(reply.statusCode, status, reply.body);
  const body = reply.json<{ error: string; message: string }>();
  assert.deepEqual(Object.keys(body).sort(), ["error", "message"]);
  assert.equal(body.error, error);
  assert.ok(body.message);
}

function uploaded(id: string, alt: string): PublicImage {
  return {
    kind: "upload",
    displayUrl: `/api/poll-images/${id}/display.webp`,
    thumbUrl: `/api/poll-images/${id}/thumb.webp`,
    width: 400,
    height: 300,
    alt,
  };
}

for (const backend of ["memory", "postgres"] as const) {
  const options = { skip: backend === "postgres" && databaseSkip };

  test(
    `${backend}: a poster can replace and remove an anonymous poll's picture`,
    options,
    async (t) => {
      const h = await harness(t, backend);
      const original = await h.upload();
      const pollId = await h.publish(original);
      const pollUrl = `/api/polls/${pollId}`;
      const initial = await h.send({ url: pollUrl });
      assert.equal(initial.statusCode, 200);
      const poll = initial.json<Record<string, unknown>>();
      assert.deepEqual(poll.attribution, { kind: "anonymous" });
      assert.deepEqual(poll.image, uploaded(original, "The old garden"));
      assert.equal("canManage" in poll, false);
      const originalBytes = await h.send({
        url: `/api/poll-images/${original}/display.webp`,
      });
      assert.equal(originalBytes.statusCode, 200);
      assert.deepEqual(await h.stored(original), {
        metadata: true,
        variants: 2,
      });

      for (const [who, canManage] of [
        [POSTER, true],
        [OWNER, false],
      ] as const) {
        const permission = await h.edit("GET", pollId, { who });
        assert.equal(permission.statusCode, 200);
        assert.deepEqual(permission.json(), { canManage });
      }
      refused(await h.edit("GET", pollId), 401, "signed_out");

      const replacement = await h.upload();
      const replaced = await h.edit("PUT", pollId, {
        who: POSTER,
        input: { id: replacement, alt: "  The new garden  " },
      });
      const image = uploaded(replacement, "The new garden");
      assert.equal(replaced.statusCode, 200, replaced.body);
      assert.deepEqual(replaced.json(), { image });
      assert.deepEqual((await h.send({ url: pollUrl })).json(), {
        ...poll,
        image,
      });
      assert.deepEqual(await h.stored(original), {
        metadata: false,
        variants: 0,
      });
      assert.deepEqual(await h.stored(replacement), {
        metadata: true,
        variants: 2,
      });

      const auditBeforeStaleDelete = await h.audit(pollId);
      refused(
        await h.edit("DELETE", pollId, { who: POSTER, expected: original }),
        409,
        "image_changed",
      );
      assert.deepEqual(await h.audit(pollId), auditBeforeStaleDelete);
      assert.deepEqual((await h.send({ url: pollUrl })).json(), {
        ...poll,
        image,
      });
      assert.deepEqual(await h.stored(replacement), {
        metadata: true,
        variants: 2,
      });

      const replacementBytes = await h.send({
        url: `/api/poll-images/${replacement}/display.webp`,
      });
      assert.equal(replacementBytes.statusCode, 200);
      const removed = await h.edit("DELETE", pollId, {
        who: POSTER,
        expected: replacement,
      });
      assert.equal(removed.statusCode, 200, removed.body);
      assert.deepEqual(removed.json(), { image: TILE });
      assert.deepEqual((await h.send({ url: pollUrl })).json(), {
        ...poll,
        image: TILE,
      });
      for (const id of [original, replacement]) {
        assert.deepEqual(await h.stored(id), { metadata: false, variants: 0 });
        for (const variant of ["display", "thumb"]) {
          const reply = await h.send({
            url: `/api/poll-images/${id}/${variant}.webp`,
          });
          assert.equal(reply.statusCode, 404);
        }
      }
      const audit = await h.audit(pollId);
      assert.deepEqual(
        audit,
        [
          {
            action: "image_attach",
            id: original,
            bytes: originalBytes.rawPayload,
          },
          {
            action: "image_replace",
            id: replacement,
            bytes: replacementBytes.rawPayload,
          },
          {
            action: "image_remove",
            id: replacement,
            bytes: replacementBytes.rawPayload,
          },
        ].map(({ action, id, bytes }) => ({
          action,
          imageId: id,
          imageSha256: createHash("sha256").update(bytes).digest("hex"),
          actorKind: "poster",
          actorId: POSTER.id,
        })),
      );
      assert.deepEqual((await h.edit("GET", pollId, { who: POSTER })).json(), {
        canManage: true,
      });
      refused(
        await h.edit("DELETE", pollId, { who: POSTER, expected: replacement }),
        409,
        "image_changed",
      );
      const alreadyRemoved = await h.edit("DELETE", pollId, { who: POSTER });
      assert.equal(alreadyRemoved.statusCode, 200, alreadyRemoved.body);
      assert.deepEqual(alreadyRemoved.json(), { image: TILE });
      assert.deepEqual(await h.audit(pollId), audit);
    },
  );

  test(
    `${backend}: poll picture refusals preserve the attachment, pending upload and audit`,
    options,
    async (t) => {
      const h = await harness(t, backend);
      const original = await h.upload();
      const pollId = await h.publish(original);
      const pending = await h.upload(OWNER);
      const expected = randomUUID();
      const input = { id: pending, alt: "Another garden" };
      const unknown = "absent-poll";
      const unknownResponse = await h.send({ url: `/api/polls/${unknown}` });
      const audit = await h.audit(pollId);

      for (const method of ["PUT", "DELETE"] as const) {
        const args = method === "PUT" ? { input } : { expected };
        refused(await h.edit(method, pollId, args), 401, "signed_out");
        refused(
          await h.edit(method, pollId, {
            ...args,
            who: POSTER,
            origin: "https://elsewhere.test",
          }),
          403,
          "origin_not_allowed",
        );
        refused(
          await h.edit(method, pollId, { ...args, who: OWNER }),
          403,
          "poster_required",
        );
        const missing = await h.edit(method, unknown, { ...args, who: OWNER });
        refused(missing, 404, "not_found");
        assert.equal(missing.body, unknownResponse.body);
      }
      refused(await h.edit("GET", unknown), 401, "signed_out");
      const missing = await h.edit("GET", unknown, { who: POSTER });
      refused(missing, 404, "not_found");
      assert.equal(missing.body, unknownResponse.body);
      refused(
        await h.edit("PUT", pollId, { who: POSTER, input }),
        422,
        "image_unavailable",
      );
      refused(
        await h.edit("PUT", pollId, {
          who: POSTER,
          input: { ...input, alt: "" },
        }),
        400,
        "bad_request",
      );
      refused(
        await h.edit("DELETE", pollId, { who: POSTER, expected: "bad" }),
        400,
        "bad_request",
      );
      refused(
        await h.edit("PUT", pollId, {
          who: POSTER,
          input: { ...input, alt: "x".repeat(33 * 1024) },
        }),
        413,
        "body_too_large",
      );
      assert.deepEqual(
        (await h.send({ url: `/api/polls/${pollId}` })).json<{
          image: PublicImage;
        }>().image,
        uploaded(original, "The old garden"),
      );

      if (h.pool) {
        await h.pool.query("update polls set hidden = true where id = $1", [
          pollId,
        ]);
        for (const method of ["GET", "PUT", "DELETE"] as const) {
          const args =
            method === "PUT"
              ? { input }
              : method === "DELETE"
                ? { expected }
                : {};
          for (const who of [POSTER, OWNER]) {
            const hidden = await h.edit(method, pollId, { ...args, who });
            refused(hidden, 404, "not_found");
            assert.equal(hidden.body, unknownResponse.body);
          }
        }
      }
      assert.deepEqual(await h.stored(original), {
        metadata: true,
        variants: 2,
      });
      assert.deepEqual(await h.stored(pending), {
        metadata: true,
        variants: 2,
      });
      assert.deepEqual(await h.audit(pollId), audit);
    },
  );
}

function racePictureEdits<T>(
  pool: Pool,
  pollId: string,
  run: () => Promise<T>,
) {
  // Both edits queue on the voter before one proceeds to the poll. Require
  // the poll read to wait: its later UPDATE would also block on this row.
  return atBarrier(
    pool,
    "select 1 from polls where id = $1 for update",
    [pollId],
    2,
    () =>
      atBarrier(
        pool,
        "select 1 from voter where id = $1 for update",
        [POSTER.id],
        2,
        run,
      ),
    /^select\b.*\bfrom polls\b/i,
  );
}

test(
  "postgres: concurrent poll picture removals cannot both reuse one confirmation",
  { skip: databaseSkip },
  async (t) => {
    const h = await harness(t, "postgres");
    assert.ok(h.pool);
    const original = await h.upload();
    const pollId = await h.publish(original);
    const before = await h.audit(pollId);
    const remove = () =>
      h.edit("DELETE", pollId, { who: POSTER, expected: original });
    const replies = await racePictureEdits(h.pool, pollId, () =>
      Promise.all([remove(), remove()]),
    );
    const [removed, stale] = replies.sort(
      (a, b) => a.statusCode - b.statusCode,
    );
    assert.equal(removed.statusCode, 200, removed.body);
    assert.deepEqual(removed.json(), { image: TILE });
    refused(stale, 409, "image_changed");
    assert.deepEqual(await h.stored(original), {
      metadata: false,
      variants: 0,
    });
    const audit = await h.audit(pollId);
    assert.deepEqual(audit.slice(0, -1), before);
    assert.equal(audit.at(-1)?.action, "image_remove");
    assert.equal(audit.at(-1)?.imageId, original);
  },
);

test(
  "postgres: concurrent replacement and removal leave a consistent poll picture",
  { skip: databaseSkip },
  async (t) => {
    const h = await harness(t, "postgres");
    assert.ok(h.pool);
    const original = await h.upload();
    const replacement = await h.upload();
    const pollId = await h.publish(original);
    const alt = "The replacement garden";
    const image = uploaded(replacement, alt);
    const [put, del] = await racePictureEdits(h.pool, pollId, () =>
      Promise.all([
        h.edit("PUT", pollId, { who: POSTER, input: { id: replacement, alt } }),
        h.edit("DELETE", pollId, { who: POSTER }),
      ]),
    );
    assert.equal(put.statusCode, 200, put.body);
    assert.deepEqual(put.json(), { image });
    assert.equal(del.statusCode, 200, del.body);
    assert.deepEqual(del.json(), { image: TILE });

    const poll = await h.send({ url: `/api/polls/${pollId}` });
    assert.equal(poll.statusCode, 200, poll.body);
    const { image: finalImage } = poll.json<{ image: PublicImage }>();
    const {
      rows: [link],
    } = await h.pool.query<{ image_id: string | null }>(
      "select image_id from polls where id = $1",
      [pollId],
    );
    const kept = finalImage.kind === "upload";
    assert.deepEqual(finalImage, kept ? image : TILE);
    assert.equal(link?.image_id, kept ? replacement : null);
    assert.deepEqual(await h.stored(original), {
      metadata: false,
      variants: 0,
    });
    assert.deepEqual(await h.stored(replacement), {
      metadata: kept,
      variants: kept ? 2 : 0,
    });
    const audit = await h.audit(pollId);
    assert.deepEqual(
      audit.map(({ action, imageId }) => [action, imageId]).sort(),
      [
        ["image_attach", original],
        ["image_remove", kept ? original : replacement],
        ["image_replace", replacement],
      ],
    );
  },
);

test("poll picture reads and removals have separate limits even without a session", async (t) => {
  const h = await harness(t, "memory");
  for (let attempt = 0; attempt < 120; attempt++) {
    refused(await h.edit("GET", "absent-poll"), 401, "signed_out");
  }
  refused(await h.edit("GET", "absent-poll"), 429, "too_many_requests");
  for (let attempt = 0; attempt < 30; attempt++) {
    refused(await h.edit("DELETE", "absent-poll"), 401, "signed_out");
  }
  refused(await h.edit("DELETE", "absent-poll"), 429, "too_many_requests");
});

test("poll picture routes distinguish storage outages from unexpected faults", async (t) => {
  const h = await harness(t, "memory", () => ({
    async canManagePicture() {
      throw Object.assign(new Error("storage unavailable"), {
        code: "ECONNRESET",
      });
    },
    async changePicture() {
      throw new Error(POSTER.email);
    },
  }));
  refused(
    await h.edit("GET", "any-poll", { who: POSTER }),
    503,
    "images_unavailable",
  );
  refused(
    await h.edit("DELETE", "any-poll", { who: POSTER }),
    500,
    "server_error",
  );
});
