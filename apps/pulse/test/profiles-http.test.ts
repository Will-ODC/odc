import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { PROFILE_BODY_LIMIT } from "../src/http/profiles.js";
import { databaseSkip } from "./support/database.js";
import {
  fixture,
  response,
  errorResponse,
  publicSchema,
  ownerSchema,
  draft,
  owner,
  other,
} from "./support/profiles-http.js";

const options = { skip: databaseSkip };
test(
  "Postgres HTTP profiles create, read, update, hide and reshare a stable public projection",
  options,
  async (t) => {
    const f = await fixture(t);
    assert.deepEqual(await response(await f.get(), 200, ownerSchema), {
      profile: null,
    });
    const made = (
      await response(
        await f.put({ ...draft(), displayName: " Ada ", bio: " Neighbour " }),
        200,
        ownerSchema,
      )
    ).profile!;
    assert.equal(made.displayName, "Ada");
    assert.equal(made.bio, "Neighbour");
    const path = `/profiles/${made.publicId}`;
    const publicResponse = await f.get(path, {});
    assert.equal(publicResponse.headers.get("set-cookie"), null);
    const shared = await response(publicResponse, 200, publicSchema);
    assert.deepEqual(shared, {
      publicId: made.publicId,
      displayName: "Ada",
      bio: "Neighbour",
      createdAt: made.createdAt,
    });
    assert.deepEqual(
      (await response(await f.get(), 200, ownerSchema)).profile,
      made,
    );
    assert.deepEqual(
      await response(
        await f.get("/me/profile", { cookie: f.cookie(other) }),
        200,
        ownerSchema,
      ),
      { profile: null },
    );
    const hidden = (
      await response(
        await f.put({
          ...draft(),
          displayName: "New name",
          bio: "",
          visible: false,
        }),
        200,
        ownerSchema,
      )
    ).profile!;
    assert.equal(hidden.publicId, made.publicId);
    assert.equal(hidden.createdAt, made.createdAt);
    assert.equal(hidden.visible, false);
    assert.deepEqual(
      (await response(await f.get(), 200, ownerSchema)).profile,
      hidden,
    );
    const missing: { error: string; message: string }[] = [];
    for (const id of [made.publicId, randomUUID(), "malformed"]) {
      const res = await f.get(`/profiles/${id}`, {});
      assert.equal(res.headers.get("set-cookie"), null);
      missing.push(await errorResponse(res, 404, "not_found"));
    }
    assert.deepEqual(
      missing,
      missing.map(() => missing[0]),
    );
    const reshared = (await response(await f.put(), 200, ownerSchema)).profile!;
    assert.equal(reshared.publicId, made.publicId);
    assert.equal(reshared.createdAt, made.createdAt);
    assert.equal(
      (await response(await f.get(path, {}), 200, publicSchema)).displayName,
      "Ada",
    );
  },
);

test(
  "Postgres HTTP refuses stale owner drafts without creating or overwriting either account",
  options,
  async (t) => {
    const f = await fixture(t);
    await response(
      await f.put({ ...draft(), visible: false }),
      200,
      ownerSchema,
    );
    const stale = () =>
      f.put(
        { ...draft(), displayName: "A private draft" },
        { cookie: f.cookie(other) },
      );
    await f.rejects(stale, 409, "account_changed");
    await response(
      await f.put(
        { ...draft(other), displayName: "B", bio: "B private", visible: false },
        { cookie: f.cookie(other) },
      ),
      200,
      ownerSchema,
    );
    await f.rejects(stale, 409, "account_changed");
  },
);

test(
  "Postgres HTTP refuses malformed profile bodies, text rules and oversized bodies without writes",
  options,
  async (t) => {
    // More than 30 intentionally refused requests: validation, not throttling, is under test.
    const f = await fixture(t, {
      rateLimit: { max: 200, timeWindow: "1 minute" },
    });
    await response(await f.put(), 200, ownerSchema);
    for (const body of [
      null,
      [],
      {},
      { ...draft(), extra: true },
      { ...draft(), ownerAccountId: undefined },
      { ...draft(), ownerAccountId: null },
      { ...draft(), ownerAccountId: "" },
      { ...draft(), ownerAccountId: 1 },
      { ...draft(), displayName: undefined },
      { ...draft(), bio: undefined },
      { ...draft(), visible: undefined },
      { ...draft(), displayName: 3 },
      { ...draft(), bio: null },
      { ...draft(), visible: "yes" },
      ...[
        "",
        " ",
        "x".repeat(81),
        "😀".repeat(81),
        "\u200b",
        "\u200c\u200d",
        "\u0301",
        "A\u202e",
        "A\u2066",
        "A\nB",
        "A\u0000",
        "\ud800",
      ].map((displayName) => ({ ...draft(), displayName })),
      ...["x".repeat(281), "😀".repeat(281), "bad\u0000bio", "\ud800"].map(
        (bio) => ({ ...draft(), bio }),
      ),
    ])
      await f.rejects(() => f.put(body), 400, "bad_request");
    for (const raw of [
      "{",
      '{"__proto__":{}}',
      Buffer.from([0x22, 0xff, 0x22]),
    ])
      await f.rejects(() => f.raw(raw), 400, "bad_request");
    await f.rejects(
      () => f.put(draft(), { "content-type": "text/plain" }),
      400,
      "bad_request",
    );
    await f.rejects(
      () => f.put({ ...draft(), bio: "x".repeat(PROFILE_BODY_LIMIT) }),
      413,
      "body_too_large",
    );
    // Unicode code points, joining characters and plain markup text remain accepted.
    for (const fields of [
      { displayName: "😀".repeat(80), bio: "😀".repeat(280) },
      { displayName: "👩‍🌾", bio: "<script>plain text</script>" },
      { displayName: "می‌روم", bio: "" },
    ]) {
      const saved = (
        await response(await f.put({ ...draft(), ...fields }), 200, ownerSchema)
      ).profile!;
      assert.equal(saved.displayName, fields.displayName);
      assert.equal(saved.bio, fields.bio);
    }
  },
);

test(
  "Postgres HTTP owner routes reject signed-out, forged, expired and revoked sessions and foreign PUT origins",
  options,
  async (t) => {
    const f = await fixture(t);
    await response(await f.put(), 200, ownerSchema);
    for (const cookie of ["", "pulse_session=forged", f.expiredCookie]) {
      await f.rejects(
        () => f.get("/me/profile", { cookie }),
        401,
        "signed_out",
      );
      await f.rejects(() => f.put(draft(), { cookie }), 401, "signed_out");
    }
    for (const origin of ["", "https://attacker.test"]) {
      await f.rejects(
        () => f.put(draft(), { origin }),
        403,
        "origin_not_allowed",
      );
      await f.rejects(() => f.raw("{", { origin }), 403, "origin_not_allowed");
    }
    await f.pool.query(
      "update voter set session_generation=session_generation+1 where id=$1",
      [owner],
    );
    await f.rejects(() => f.get(), 401, "signed_out");
    await f.rejects(() => f.put(), 401, "signed_out");
  },
);

for (const method of ["GET", "PUT"])
  test(
    `Postgres HTTP profile ${method} rate limit refuses without writes`,
    options,
    async (t) => {
      const f = await fixture(t, {
        rateLimit: { max: 1, timeWindow: "1 minute" },
      });
      // A refusal counts too; GET and PUT have separate route buckets.
      const request =
        method === "GET"
          ? () => f.get("/me/profile", { cookie: "" })
          : () => f.put({});
      await f.rejects(
        request,
        method === "GET" ? 401 : 400,
        method === "GET" ? "signed_out" : "bad_request",
      );
      await f.rejects(request, 429, "too_many_requests");
    },
  );

test(
  "Postgres HTTP profile storage faults return safe errors without changing saved profiles",
  options,
  async (t) => {
    const f = await fixture(t);
    const made = (await response(await f.put(), 200, ownerSchema)).profile!;
    await f.stopStorage();
    await f.rejects(() => f.get(), 500, "server_error");
    await f.rejects(() => f.put(), 500, "server_error");
    await f.rejects(
      () => f.get(`/profiles/${made.publicId}`, {}),
      500,
      "server_error",
    );
  },
);

test(
  "Postgres HTTP unconfigured profile storage refuses owner routes and hides public profiles",
  options,
  async (t) => {
    const f = await fixture(t, { storage: false });
    await f.rejects(() => f.get(), 500, "server_error");
    await f.rejects(() => f.put(), 500, "server_error");
    await f.rejects(
      () => f.get(`/profiles/${randomUUID()}`, {}),
      404,
      "not_found",
    );
  },
);

test(
  "Postgres HTTP owner read refuses a read made for another account",
  options,
  async (t) => {
    const f = await fixture(t);
    await response(
      await f.put({ ...draft(), visible: false }),
      200,
      ownerSchema,
    );
    // The editor reading for `owner` while `other` is signed in gets nothing.
    await errorResponse(
      await f.get(`/me/profile?ownerAccountId=${owner}`, {
        cookie: f.cookie(other),
      }),
      409,
      "account_changed",
    );
    await errorResponse(
      await f.get("/me/profile?ownerAccountId=", { cookie: f.cookie() }),
      400,
      "bad_request",
    );
    const own = await response(
      await f.get(`/me/profile?ownerAccountId=${owner}`),
      200,
      ownerSchema,
    );
    assert.equal(own.profile?.displayName, draft().displayName);
  },
);

const BAD_LIST_QUERIES = [
  "?cursor=",
  "?cursor=invalid",
  "?cursor=a&cursor=b",
  `?cursor=${"a".repeat(1025)}`,
  `?cursor=${Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: randomUUID() })).toString("base64url")}`,
  "?extra=true",
];

test(
  "Postgres HTTP profile contribution lists refuse bad cursors and unknown query fields",
  options,
  async (t) => {
    const f = await fixture(t);
    const { publicId } = (await response(await f.put(), 200, ownerSchema))
      .profile!;
    for (const query of BAD_LIST_QUERIES) {
      await errorResponse(
        await f.get(`/profiles/${publicId}/contributions${query}`, {}),
        400,
        "bad_request",
      );
      await errorResponse(
        await f.get(`/me/contributions${query}`),
        400,
        "bad_request",
      );
    }
    // The account precondition does not excuse another unknown field.
    await errorResponse(
      await f.get(`/me/contributions?ownerAccountId=${owner}&extra=true`),
      400,
      "bad_request",
    );
  },
);

test(
  "Postgres HTTP contribution detail with a non-UUID id is not found while profiles are configured",
  options,
  async (t) => {
    const f = await fixture(t);
    await response(await f.put(), 200, ownerSchema);
    for (const id of ["not-an-id", "1234", `${randomUUID()}x`])
      await errorResponse(
        await f.get(`/contributions/${id}`, {}),
        404,
        "not_found",
      );
  },
);

test(
  "Postgres HTTP profile contribution lists answer 503 without contribution storage",
  options,
  async (t) => {
    const f = await fixture(t, { contributions: false });
    const { publicId } = (await response(await f.put(), 200, ownerSchema))
      .profile!;
    await errorResponse(
      await f.get(`/profiles/${publicId}/contributions`, {}),
      503,
      "contributions_unavailable",
    );
    await errorResponse(
      await f.get(`/me/contributions?ownerAccountId=${owner}`),
      503,
      "contributions_unavailable",
    );
  },
);

test(
  "Postgres HTTP profile contribution lists page through only the owner's rows",
  options,
  async (t) => {
    let clock = new Date("2026-11-10T12:00:00.000Z");
    const f = await fixture(t, { clock: () => clock });
    const { publicId } = (await response(await f.put(), 200, ownerSchema))
      .profile!;
    const input = (title: string) => ({
      title,
      description: "A public contribution.",
      organizerName: "Same public name",
      kind: "project" as const,
    });
    const mine: string[] = [];
    for (let hour = 0; hour < 23; hour++) {
      clock = new Date(clock.getTime() + 3_600_001);
      mine.unshift(
        (
          await f.contributions!.create(
            { voterId: owner, sessionGeneration: 0 },
            randomUUID(),
            input(`Owner ${hour}`),
          )
        ).contribution.id,
      );
      await f.contributions!.create(
        { voterId: other, sessionGeneration: 0 },
        randomUUID(),
        input(`Other ${hour}`),
      );
    }
    const page = z
      .object({
        contributions: z.array(z.object({ id: z.uuid() }).loose()),
        nextCursor: z.string().nullable(),
      })
      .strict();
    for (const path of [
      `/profiles/${publicId}/contributions`,
      `/me/contributions?ownerAccountId=${owner}`,
    ]) {
      const headers = path.startsWith("/me") ? { cookie: f.cookie() } : {};
      const joiner = path.includes("?") ? "&" : "?";
      const first = await response(await f.get(path, headers), 200, page);
      assert.equal(first.contributions.length, 20);
      assert.ok(first.nextCursor);
      const second = await response(
        await f.get(
          `${path}${joiner}cursor=${encodeURIComponent(first.nextCursor)}`,
          headers,
        ),
        200,
        page,
      );
      assert.equal(second.nextCursor, null);
      assert.deepEqual(
        [...first.contributions, ...second.contributions].map((row) => row.id),
        mine,
        path,
      );
    }
  },
);
