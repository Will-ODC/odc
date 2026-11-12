import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { PROFILE_BODY_LIMIT } from "../src/http/profiles.js";
import { createServer } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { InMemoryMemberProfileStore } from "../src/profiles/memory-store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const ORIGIN = "https://pulse.example";
const SECRET = "profile-test-secret-that-is-long-enough";
const AT = new Date("2026-11-12T12:00:00.000Z");
const IDS = [
  "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8",
  "b94ecf7f-fcf6-4131-a637-6ce4f4d671e2",
];

async function setup(rateLimit?: { max: number; timeWindow: string }) {
  const voters = new InMemoryVoterStore();
  for (const id of ["owner-private-id", "other-private-id"])
    await voters.create(
      {
        id,
        community: null,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${id}@example.test`, verifiedAt: AT },
    );
  let next = 0;
  const profiles = new InMemoryMemberProfileStore(voters, {
    clock: () => AT,
    newId: () => IDS[next++] as string,
  });
  const signer = new SessionSigner(SECRET, { clock: () => AT });
  const app = await createServer({
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `${ORIGIN}/sign-in?token=${token}`,
    }),
    voters,
    votes: new InMemoryVotingStore(() => AT),
    suggestions: new InMemorySuggestionStore({ clock: () => AT }),
    signer,
    profiles,
    webOrigin: ORIGIN,
    secureCookies: false,
    ...(rateLimit ? { profileRateLimit: rateLimit } : {}),
  });
  interface TestResponse {
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
    json(): Record<string, unknown> & {
      error?: string;
      profile: { publicId: string };
    };
  }
  return {
    app,
    cookie(id = "owner-private-id") {
      return `${SESSION_COOKIE}=${signer.sign(id, 0)}`;
    },
    async put(
      body: Record<string, unknown>,
      options: { cookie?: string; origin?: string; contentType?: string } = {},
    ): Promise<TestResponse> {
      const response = await app.inject({
        method: "PUT",
        url: "/api/me/profile",
        headers: {
          ...(options.cookie === ""
            ? {}
            : { cookie: options.cookie ?? this.cookie() }),
          ...(options.origin === ""
            ? {}
            : { origin: options.origin ?? ORIGIN }),
          "content-type": options.contentType ?? "application/json",
        },
        payload: body,
      });
      return response as unknown as TestResponse;
    },
  };
}

test("owner_can_create_read_update_hide_and_reshare_a_stable_profile", async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  const empty = await h.app.inject({
    url: "/api/me/profile",
    headers: { cookie: h.cookie() },
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { profile: null });
  assert.equal(empty.headers["cache-control"], "no-store");

  const made = await h.put({
    displayName: " Ada ",
    bio: " Neighbour ",
    visible: true,
  });
  assert.equal(made.statusCode, 200);
  const publicId = made.json().profile.publicId as string;
  assert.equal(publicId, IDS[0]);
  assert.equal(JSON.stringify(made.json()).includes("example.test"), false);

  const shared = await h.app.inject({ url: `/api/profiles/${publicId}` });
  assert.deepEqual(shared.json(), {
    publicId,
    displayName: "Ada",
    bio: "Neighbour",
    createdAt: AT.toISOString(),
  });
  assert.equal(shared.headers["cache-control"], "no-store");
  // A public read never starts or refreshes a session.
  assert.equal(shared.headers["set-cookie"], undefined);

  const hidden = await h.put({ displayName: "Ada", bio: "", visible: false });
  assert.equal(hidden.json().profile.publicId, publicId);
  const unavailable = await h.app.inject({ url: `/api/profiles/${publicId}` });
  assert.equal(unavailable.statusCode, 404);
  assert.equal(unavailable.headers["cache-control"], "no-store");
  assert.equal(unavailable.headers["set-cookie"], undefined);

  const reshared = await h.put({
    displayName: "Ada Lovelace",
    bio: "",
    visible: true,
  });
  assert.equal(reshared.json().profile.publicId, publicId);
});

test("malformed_missing_and_hidden_public_profiles_are_indistinguishable", async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  await h.put({ displayName: "Ada", bio: "", visible: false });
  const paths = [
    "/api/profiles/not-a-public-id",
    "/api/profiles/00000000-0000-4000-8000-000000000000",
    `/api/profiles/${IDS[0]}`,
  ];
  const responses = await Promise.all(
    paths.map((url) => h.app.inject({ url })),
  );
  assert.deepEqual(
    responses.map((response) => [response.statusCode, response.body]),
    responses.map(() => [
      404,
      '{"error":"not_found","message":"That profile is unavailable."}',
    ]),
  );
  // Not cached either: a hidden profile shown again must not stay "missing".
  for (const response of responses) {
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["set-cookie"], undefined);
  }
});

test("owner_routes_refuse_signed_out_foreign_origin_and_other_accounts", async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  assert.equal(
    (await h.app.inject({ url: "/api/me/profile" })).json().error,
    "signed_out",
  );
  for (const origin of ["", "https://attacker.example"])
    assert.equal(
      (
        await h.put({ displayName: "Ada", bio: "", visible: true }, { origin })
      ).json().error,
      "origin_not_allowed",
    );

  await h.put({ displayName: "Ada", bio: "", visible: true });
  const other = await h.app.inject({
    url: "/api/me/profile",
    headers: { cookie: h.cookie("other-private-id") },
  });
  assert.deepEqual(other.json(), { profile: null });
});

test("profile_http_enforces_display_name_and_bio_limits", async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  assert.equal(
    (
      await h.put({
        displayName: "😀".repeat(80),
        bio: "😀".repeat(280),
        visible: true,
      })
    ).statusCode,
    200,
  );
  for (const body of [
    { displayName: "", bio: "", visible: true },
    { displayName: "x".repeat(81), bio: "", visible: true },
    { displayName: "Ada", bio: "x".repeat(281), visible: true },
    { displayName: "Ada", bio: "", visible: "yes" },
  ]) {
    const response = await h.put(body);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "bad_request");
  }
});

test("profile_http_limits_body_and_request_rate", async (t) => {
  const h = await setup({ max: 1, timeWindow: "1 minute" });
  t.after(() => h.app.close());
  const invalid = await h.put({
    displayName: "x".repeat(81),
    bio: "",
    visible: true,
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "bad_request");
  assert.equal(
    (await h.put({ displayName: "Ada", bio: "", visible: true })).statusCode,
    429,
  );

  const separate = await setup();
  t.after(() => separate.app.close());
  const large = await separate.app.inject({
    method: "PUT",
    url: "/api/me/profile",
    headers: {
      cookie: separate.cookie(),
      origin: ORIGIN,
      "content-type": "application/json",
    },
    payload: `{"displayName":"Ada","bio":"${"x".repeat(PROFILE_BODY_LIMIT)}","visible":true}`,
  });
  assert.equal(large.statusCode, 413);
  assert.equal(large.json().error, "body_too_large");
});
