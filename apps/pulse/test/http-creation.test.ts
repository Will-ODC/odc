import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import type { InjectOptions } from "fastify";
import type { Pool } from "pg";
import { CreationError, PURPOSE_VERSION } from "../src/authoring/input.js";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import type { CreationStore } from "../src/authoring/store.js";
import { createPool } from "../src/db/pool.js";
import { CREATION_BODY_LIMIT } from "../src/http/creation.js";
import { createServer, type ServerDeps } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
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
import { SERVED_LOGGER } from "../src/main.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore, type VotingStore } from "../src/voting/store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

const SECRET = "test-secret-that-is-long-enough";
const ORIGIN = "https://pulse.example.org";
const START = new Date("2026-10-20T12:00:00.000Z");
const HOUR_S = 3600;

/** The accounts every test starts with. Ids and addresses must never leak. */
const ACCOUNTS = {
  owner: {
    id: "acct-owner-7f3a",
    email: "owner@example.test",
    community: null,
  },
  member: {
    id: "acct-member-91c2",
    email: "member@campus.test",
    community: "campus",
  },
  guest: {
    id: "acct-guest-44d0",
    email: "guest@example.test",
    community: null,
  },
} as const;
type Who = keyof typeof ACCOUNTS;

/** A valid creation request; override any field. */
function question(overrides: Record<string, unknown> = {}) {
  return {
    question: "Should we open a community garden?",
    choices: ["Yes", "No"],
    method: "single",
    purposeAcknowledgement: PURPOSE_VERSION,
    ...overrides,
  };
}

type Kind = "memory" | "postgres";

interface Harness {
  app: Awaited<ReturnType<typeof createServer>>;
  voters: VoterStore;
  votes: VotingStore;
  signer: SessionSigner;
  /** Every response this harness has seen, for the leak checks. */
  seen: { body: string; headers: Record<string, unknown> }[];
  logs: string[];
  cookie(who: Who): string;
  after(seconds: number): void;
  publish(
    who: Who | undefined,
    body: unknown,
    options?: {
      key?: string | null;
      origin?: string | null;
      contentType?: string | null;
      raw?: string | Buffer;
    },
  ): Promise<Response>;
  context(who: Who | undefined, cookie?: string): Promise<Response>;
  grant(
    who: Who | undefined,
    target: string,
    options?: { origin?: string | null; body?: unknown; contentType?: string },
  ): Promise<Response>;
  revoke(
    who: Who | undefined,
    target: string,
    options?: { origin?: string | null; body?: string },
  ): Promise<Response>;
}

/** What a test reads off a response. */
interface Response {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  json(): Record<string, unknown> & {
    error?: string;
    message?: string;
    poll?: Record<string, unknown> & { id: string };
    replayed?: boolean;
  };
}

async function harness(
  t: TestContext,
  kind: Kind,
  overrides: Partial<ServerDeps> & {
    creationStore?: CreationStore | null;
    noWebOrigin?: boolean;
  } = {},
): Promise<Harness> {
  let now = START;
  const clock = () => now;
  const pool: Pool | undefined =
    kind === "postgres" ? await migratedSchema(t) : undefined;
  if (pool)
    await pool.query("insert into community (id, label) values ($1, $2)", [
      "campus",
      "Campus",
    ]);
  const voters: VoterStore = pool
    ? new PostgresVoterStore(pool)
    : new InMemoryVoterStore();
  const votes: VotingStore = pool
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
  const options = { ownerEmail: ACCOUNTS.owner.email, clock };
  const creation =
    overrides.creationStore === null
      ? undefined
      : (overrides.creationStore ??
        (pool
          ? new PostgresCreationStore(pool, options)
          : new InMemoryCreationStore(
              voters as InMemoryVoterStore,
              votes as InMemoryVotingStore,
              { ...options, communityLabels: new Map([["campus", "Campus"]]) },
            )));
  const signer = new SessionSigner(SECRET, { ttlSeconds: 3600, clock });
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const { noWebOrigin, ...rest } = overrides;
  const deps: Partial<ServerDeps> = { ...rest };
  delete (deps as { creationStore?: unknown }).creationStore;
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
    ...(noWebOrigin === true ? {} : { webOrigin: ORIGIN }),
    // The served logger, at info, so every request line is recorded and the
    // leak checks read what production would write down.
    logger: { ...SERVED_LOGGER, level: "info", stream },
    ...(creation === undefined ? {} : { creation }),
    ...deps,
  });
  t.after(() => app.close());

  const seen: Harness["seen"] = [];
  const send = async (request: InjectOptions): Promise<Response> => {
    const response = await app.inject(request);
    seen.push({ body: response.body, headers: response.headers });
    return response as unknown as Response;
  };
  const cookie = (who: Who) =>
    `${SESSION_COOKIE}=${signer.sign(ACCOUNTS[who].id, 0)}`;
  const headersFor = (
    who: Who | undefined,
    origin: string | null | undefined,
    contentType: string | null | undefined,
  ) => ({
    ...(who === undefined ? {} : { cookie: cookie(who) }),
    ...(origin === null ? {} : { origin: origin ?? ORIGIN }),
    ...(contentType === null
      ? {}
      : { "content-type": contentType ?? "application/json" }),
  });

  return {
    app,
    voters,
    votes,
    signer,
    seen,
    logs,
    cookie,
    after(seconds) {
      now = new Date(now.getTime() + seconds * 1000);
    },
    publish(who, body, options = {}) {
      const key = options.key === undefined ? randomUUID() : options.key;
      return send({
        method: "POST",
        url: "/api/polls",
        headers: {
          ...headersFor(who, options.origin, options.contentType),
          ...(key === null ? {} : { "idempotency-key": key }),
        },
        payload: options.raw ?? JSON.stringify(body),
      });
    },
    context(who, cookieOverride) {
      return send({
        method: "GET",
        url: "/api/poll-creation/context",
        headers:
          cookieOverride !== undefined
            ? { cookie: cookieOverride }
            : who === undefined
              ? {}
              : { cookie: cookie(who) },
      });
    },
    grant(who, target, options = {}) {
      return send({
        method: "PUT",
        url: `/api/posting-permissions/${encodeURIComponent(target)}`,
        headers: headersFor(who, options.origin, options.contentType),
        payload: JSON.stringify(
          options.body === undefined
            ? { permission: "unlimited_posting" }
            : options.body,
        ),
      });
    },
    revoke(who, target, options = {}) {
      return send({
        method: "DELETE",
        url: `/api/posting-permissions/${encodeURIComponent(target)}`,
        headers: headersFor(
          who,
          options.origin,
          options.body === undefined ? null : "application/json",
        ),
        ...(options.body === undefined ? {} : { payload: options.body }),
      });
    },
  };
}

function refused(response: Response, status: number, error: string): void {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error, error);
  const message = response.json().message;
  assert.equal(typeof message, "string");
  assert.ok((message as string).length > 0);
}

for (const kind of ["memory", "postgres"] as const) {
  const skip = kind === "postgres" ? databaseSkip : false;
  const it = (name: string, body: (t: TestContext) => Promise<void>) =>
    test(`${kind}: ${name}`, { skip }, body);

  it("context_reports_the_posting_community_and_the_callers_own_permission", async (t) => {
    const h = await harness(t, kind);
    const guest = await h.context("guest");
    assert.equal(guest.statusCode, 200);
    assert.deepEqual(guest.json(), {
      community: { id: "pulse-general", label: "General" },
      canPostUnlimited: false,
      purposeVersion: PURPOSE_VERSION,
      purposeAcknowledged: false,
    });
    assert.equal(guest.headers["cache-control"], "no-store");

    const member = await h.context("member");
    assert.deepEqual(member.json().community, {
      id: "campus",
      label: "Campus",
    });
    assert.equal((await h.context("owner")).json().canPostUnlimited, true);
  });

  it("publishing_answers_201_then_the_same_request_replays_with_200", async (t) => {
    const h = await harness(t, kind);
    const key = randomUUID();
    const first = await h.publish("guest", question(), { key });
    assert.equal(first.statusCode, 201, first.body);
    const poll = first.json().poll;
    assert.ok(poll);
    assert.equal(first.json().replayed, false);
    assert.deepEqual(Object.keys(first.json()).sort(), ["poll", "replayed"]);
    assert.deepEqual(
      { ...poll, id: "x" },
      {
        id: "x",
        question: "Should we open a community garden?",
        choices: ["Yes", "No"],
        method: "single",
        next: [null, null],
        acceptsSuggestions: false,
        closesAt: new Date(
          START.getTime() + 7 * 24 * HOUR_S * 1000,
        ).toISOString(),
        open: true,
        community: { id: "pulse-general", label: "General" },
        attribution: { kind: "anonymous" },
      },
    );

    const again = await h.publish("guest", question(), { key });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().replayed, true);
    assert.deepEqual(again.json().poll, poll);

    // The poll is an ordinary poll: anyone can read it and vote on it.
    const read = await h.app.inject({ url: `/api/polls/${poll.id}` });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().question, "Should we open a community garden?");
    const vote = await h.app.inject({
      method: "POST",
      url: `/api/polls/${poll.id}/votes`,
      payload: { ballot: [0] },
    });
    assert.equal(vote.statusCode, 200);
    assert.equal(vote.json().status, "counted");
  });

  it("a_replay_is_not_charged_against_the_hourly_limit", async (t) => {
    const h = await harness(t, kind);
    const key = randomUUID();
    assert.equal(
      (await h.publish("guest", question(), { key })).statusCode,
      201,
    );
    for (let i = 0; i < 3; i += 1)
      assert.equal(
        (await h.publish("guest", question(), { key })).statusCode,
        200,
      );
    // Four more distinct questions make five creations in the hour. Had any
    // replay been charged, one of these would be refused.
    for (let i = 0; i < 4; i += 1)
      assert.equal(
        (await h.publish("guest", question({ question: `Q${i}` }))).statusCode,
        201,
      );
    refused(
      await h.publish("guest", question({ question: "Q5" })),
      429,
      "posting_limit",
    );
  });

  it("the_same_key_with_a_different_question_is_a_conflict", async (t) => {
    const h = await harness(t, kind);
    const key = randomUUID();
    const first = await h.publish("guest", question(), { key });
    assert.equal(first.statusCode, 201);
    refused(
      await h.publish("guest", question({ choices: ["Yes", "No", "Maybe"] }), {
        key,
      }),
      409,
      "idempotency_conflict",
    );
    // A key is the account's own: another account's identical key is new.
    assert.equal(
      (await h.publish("member", question(), { key })).statusCode,
      201,
    );
  });

  it("the_sixth_question_in_an_hour_is_refused_with_retry_after", async (t) => {
    const h = await harness(t, kind);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        (await h.publish("guest", question({ question: `Q${i}` }))).statusCode,
        201,
      );
      h.after(60);
    }
    const sixth = await h.publish("guest", question({ question: "Q5" }));
    refused(sixth, 429, "posting_limit");
    // The first post was 300 seconds ago, so its slot frees in 3300.
    assert.equal(sixth.headers["retry-after"], String(HOUR_S - 300));
    assert.match(String(sixth.headers["retry-after"]), /^\d+$/);

    h.after(HOUR_S - 300);
    assert.equal(
      (await h.publish("guest", question({ question: "Q5" }))).statusCode,
      201,
    );
  });

  it("a_first_post_needs_the_promise_and_later_ones_do_not", async (t) => {
    const h = await harness(t, kind);
    const bare = question();
    delete (bare as { purposeAcknowledgement?: string }).purposeAcknowledgement;
    refused(await h.publish("guest", bare), 422, "purpose_required");
    assert.equal((await h.context("guest")).json().purposeAcknowledged, false);

    assert.equal((await h.publish("guest", question())).statusCode, 201);
    assert.equal((await h.context("guest")).json().purposeAcknowledged, true);
    assert.equal(
      (await h.publish("guest", { ...bare, question: "Another" })).statusCode,
      201,
    );
  });

  it("named_attribution_is_returned_as_kind_and_name_only", async (t) => {
    const h = await harness(t, kind);
    const named = await h.publish(
      "member",
      question({ attribution: { kind: "named", name: " Ada " } }),
    );
    assert.equal(named.statusCode, 201);
    assert.deepEqual(named.json().poll?.attribution, {
      kind: "named",
      name: "Ada",
    });
    assert.deepEqual(named.json().poll?.community, {
      id: "campus",
      label: "Campus",
    });
  });

  it("malformed_requests_are_bad_requests_and_create_nothing", async (t) => {
    const h = await harness(t, kind);
    const cases: [string, Parameters<Harness["publish"]>][] = [
      ["no key", ["guest", question(), { key: null }]],
      ["key not a uuid", ["guest", question(), { key: "not-a-uuid" }]],
      ["unknown field", ["guest", question({ community: "campus" }), {}]],
      ["writable id", ["guest", question({ id: "mine" }), {}]],
      ["no method", ["guest", question({ method: undefined }), {}]],
      ["one choice", ["guest", question({ choices: ["Only"] }), {}]],
      ["duplicate choices", ["guest", question({ choices: ["A", " A"] }), {}]],
      ["null close", ["guest", question({ closesAt: null }), {}]],
      [
        "past close",
        ["guest", question({ closesAt: "2026-10-19T12:00:00.000Z" }), {}],
      ],
      [
        "close without milliseconds",
        ["guest", question({ closesAt: "2026-10-29T12:00:00Z" }), {}],
      ],
      [
        "wrong version",
        ["guest", question({ purposeAcknowledgement: "v0" }), {}],
      ],
      [
        "anonymous with a name",
        [
          "guest",
          question({ attribution: { kind: "anonymous", name: "x" } }),
          {},
        ],
      ],
      ["NUL", ["guest", question({ question: "a\u0000b" }), {}]],
      ["array body", ["guest", [question()], {}]],
      ["text/plain", ["guest", question(), { contentType: "text/plain" }]],
      [
        "form body",
        [
          "guest",
          question(),
          { contentType: "application/x-www-form-urlencoded" },
        ],
      ],
      ["no content type", ["guest", question(), { contentType: null }]],
      ["malformed json", ["guest", null, { raw: '{"question":' }]],
      ["empty body", ["guest", null, { raw: "" }]],
      [
        "prototype key",
        [
          "guest",
          null,
          {
            raw: `{"__proto__":{"x":1},"question":"Q","choices":["A","B"],"method":"single"}`,
          },
        ],
      ],
      [
        "invalid utf-8",
        [
          "guest",
          null,
          {
            raw: Buffer.concat([
              Buffer.from('{"question":"caf'),
              Buffer.from([0xc3, 0x28]),
              Buffer.from(
                '","choices":["A","B"],"method":"single","purposeAcknowledgement":"community-purpose-v1"}',
              ),
            ]),
          },
        ],
      ],
      [
        "lone surrogate",
        [
          "guest",
          null,
          {
            raw: '{"question":"\\ud800","choices":["A","B"],"method":"single","purposeAcknowledgement":"community-purpose-v1"}',
          },
        ],
      ],
    ];
    for (const [name, args] of cases) {
      const response = await h.publish(...args);
      assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
      assert.equal(response.json().error, "bad_request", name);
    }
    // Nothing was created and no promise was recorded by any of them.
    assert.equal((await h.context("guest")).json().purposeAcknowledged, false);
    for (let i = 0; i < 5; i += 1)
      assert.equal(
        (await h.publish("guest", question({ question: `Q${i}` }))).statusCode,
        201,
      );
  });

  it("valid_astral_text_is_accepted", async (t) => {
    const h = await harness(t, kind);
    const response = await h.publish(
      "guest",
      question({ choices: ["👍", "👎"] }),
    );
    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(response.json().poll?.choices, ["👍", "👎"]);
  });

  it("a_body_over_32_kib_is_too_large_and_one_under_is_read", async (t) => {
    const h = await harness(t, kind);
    const padded = (bytes: number) => {
      const base = JSON.stringify(question({ pad: "" }));
      return JSON.stringify(question({ pad: "x".repeat(bytes - base.length) }));
    };
    assert.equal(
      Buffer.byteLength(padded(CREATION_BODY_LIMIT + 1)),
      CREATION_BODY_LIMIT + 1,
    );
    refused(
      await h.publish("guest", null, { raw: padded(CREATION_BODY_LIMIT + 1) }),
      413,
      "body_too_large",
    );
    // Exactly at the limit the body is read — and refused for its unknown
    // field, which proves it got as far as being read.
    refused(
      await h.publish("guest", null, { raw: padded(CREATION_BODY_LIMIT) }),
      400,
      "bad_request",
    );
  });

  it("owner_grants_and_revokes_unlimited_posting_and_repeats_are_no_ops", async (t) => {
    const h = await harness(t, kind);
    const target = ACCOUNTS.guest.id;
    for (let i = 0; i < 2; i += 1) {
      const granted = await h.grant("owner", target);
      assert.equal(granted.statusCode, 204);
      assert.equal(granted.body, "");
    }
    assert.equal((await h.context("guest")).json().canPostUnlimited, true);
    for (let i = 0; i < 6; i += 1)
      assert.equal(
        (await h.publish("guest", question({ question: `Q${i}` }))).statusCode,
        201,
      );

    for (let i = 0; i < 2; i += 1)
      assert.equal((await h.revoke("owner", target)).statusCode, 204);
    assert.equal((await h.context("guest")).json().canPostUnlimited, false);
    refused(
      await h.publish("guest", question({ question: "Q6" })),
      429,
      "posting_limit",
    );
  });

  it("only_the_owner_may_change_permissions_and_404_comes_after_that", async (t) => {
    const h = await harness(t, kind);
    refused(await h.grant("member", ACCOUNTS.guest.id), 403, "owner_required");
    refused(await h.revoke("member", ACCOUNTS.guest.id), 403, "owner_required");
    // A non-owner learns nothing about whether an account exists.
    refused(await h.grant("member", "no-such-account"), 403, "owner_required");
    refused(await h.revoke("member", "no-such-account"), 403, "owner_required");
    refused(await h.grant("member", ACCOUNTS.member.id), 403, "owner_required");
    assert.equal((await h.context("member")).json().canPostUnlimited, false);

    refused(await h.grant("owner", "no-such-account"), 404, "not_found");
    refused(await h.revoke("owner", "no-such-account"), 404, "not_found");
  });

  it("a_permission_body_must_be_exactly_the_one_permission", async (t) => {
    const h = await harness(t, kind);
    for (const body of [
      {},
      { permission: "full_power" },
      { permission: "unlimited_posting", extra: true },
      ["unlimited_posting"],
      "unlimited_posting",
      null,
    ])
      refused(
        await h.grant("owner", ACCOUNTS.guest.id, { body }),
        400,
        "bad_request",
      );
    refused(
      await h.grant("owner", ACCOUNTS.guest.id, { contentType: "text/plain" }),
      400,
      "bad_request",
    );
    refused(
      await h.revoke("owner", ACCOUNTS.guest.id, { body: "{}" }),
      400,
      "bad_request",
    );
    assert.equal((await h.context("guest")).json().canPostUnlimited, false);
  });

  it("every_mutation_refuses_a_missing_or_foreign_origin", async (t) => {
    const h = await harness(t, kind);
    for (const origin of [
      null,
      "https://evil.example",
      "null",
      `${ORIGIN}/`,
      "http://pulse.example.org",
      "https://pulse.example.org:443",
      "https://PULSE.example.org",
      `${ORIGIN}.evil.example`,
    ]) {
      refused(
        await h.publish("guest", question(), { origin }),
        403,
        "origin_not_allowed",
      );
      refused(
        await h.grant("owner", ACCOUNTS.guest.id, { origin }),
        403,
        "origin_not_allowed",
      );
      refused(
        await h.revoke("owner", ACCOUNTS.guest.id, { origin }),
        403,
        "origin_not_allowed",
      );
    }
    // Origin is checked before the session: an outsider with no cookie is
    // told about the origin, not invited to sign in.
    refused(
      await h.publish(undefined, question(), {
        origin: "https://evil.example",
      }),
      403,
      "origin_not_allowed",
    );
    assert.equal((await h.context("guest")).json().purposeAcknowledged, false);
    assert.equal((await h.context("guest")).json().canPostUnlimited, false);
  });

  it("every_route_refuses_a_missing_session", async (t) => {
    const h = await harness(t, kind);
    refused(await h.context(undefined), 401, "signed_out");
    refused(await h.publish(undefined, question()), 401, "signed_out");
    refused(await h.grant(undefined, ACCOUNTS.guest.id), 401, "signed_out");
    refused(await h.revoke(undefined, ACCOUNTS.guest.id), 401, "signed_out");
  });

  it("the_session_is_checked_before_the_body_is_read", async (t) => {
    const h = await harness(t, kind);
    refused(
      await h.publish(undefined, null, {
        raw: "x".repeat(CREATION_BODY_LIMIT * 2),
      }),
      401,
      "signed_out",
    );
    refused(
      await h.publish(undefined, question(), { contentType: "text/plain" }),
      401,
      "signed_out",
    );
    refused(await h.publish(undefined, null, { raw: "{" }), 401, "signed_out");
  });

  it("a_body_that_is_not_json_is_refused_before_it_is_read", async (t) => {
    // The content type is checked before Fastify reads anything: a large
    // text/plain body — what a cross-site form can send without a preflight —
    // is a 400 at once, not read up to the limit and then refused.
    const h = await harness(t, kind);
    const big = "x".repeat(CREATION_BODY_LIMIT * 2);
    for (const contentType of ["text/plain", "application/json-patch+json"])
      refused(
        await h.publish("guest", null, { raw: big, contentType }),
        400,
        "bad_request",
      );
    refused(
      await h.grant("owner", ACCOUNTS.guest.id, {
        body: big,
        contentType: "text/plain",
      }),
      400,
      "bad_request",
    );
  });

  it("a_session_revoked_by_sign_out_is_refused_everywhere", async (t) => {
    const h = await harness(t, kind);
    const cookie = h.cookie("owner");
    assert.equal((await h.context(undefined, cookie)).statusCode, 200);
    const out = await h.app.inject({
      method: "POST",
      url: "/api/sign-out",
      headers: { cookie },
    });
    assert.equal(out.statusCode, 200);

    refused(await h.context(undefined, cookie), 401, "signed_out");
    const as = { cookie, origin: ORIGIN, "content-type": "application/json" };
    for (const request of [
      {
        method: "POST" as const,
        url: "/api/polls",
        headers: { ...as, "idempotency-key": randomUUID() },
        payload: JSON.stringify(question()),
      },
      {
        method: "PUT" as const,
        url: `/api/posting-permissions/${ACCOUNTS.guest.id}`,
        headers: as,
        payload: JSON.stringify({ permission: "unlimited_posting" }),
      },
      {
        method: "DELETE" as const,
        url: `/api/posting-permissions/${ACCOUNTS.guest.id}`,
        headers: { cookie, origin: ORIGIN },
      },
    ]) {
      const response = await h.app.inject(request);
      assert.equal(
        response.statusCode,
        401,
        `${request.method}: ${response.body}`,
      );
      assert.equal(response.json().error, "signed_out");
    }
    assert.equal((await h.context("guest")).json().purposeAcknowledged, false);
  });

  it("an_expired_or_forged_session_is_refused", async (t) => {
    const h = await harness(t, kind);
    const cookie = h.cookie("guest");
    h.after(3601);
    refused(await h.context(undefined, cookie), 401, "signed_out");
    const fresh = h.cookie("guest");
    assert.equal((await h.context(undefined, fresh)).statusCode, 200);

    const other = new SessionSigner("a-completely-different-secret");
    for (const forged of [
      `${SESSION_COOKIE}=${other.sign(ACCOUNTS.owner.id, 0)}`,
      // Generation 1 was never issued: the account is still at 0.
      `${SESSION_COOKIE}=${h.signer.sign(ACCOUNTS.owner.id, 1)}`,
      // An old-format cookie with no generation.
      `${SESSION_COOKIE}=${h.signer.sign(ACCOUNTS.owner.id)}`,
      `${SESSION_COOKIE}=${h.signer.sign("no-such-account", 0)}`,
      // A ballot cookie presented as a session names nobody.
      `${SESSION_COOKIE}=${h.signer.sign("b:some-ballot")}`,
    ])
      refused(await h.context(undefined, forged), 401, "signed_out");
  });

  it("creation_never_touches_the_ballot_cookie", async (t) => {
    const h = await harness(t, kind);
    const ballot = `pulse_ballot=${h.signer.sign("b:held-ballot")}`;
    const withBallot = `${h.cookie("owner")}; ${ballot}`;
    const responses = [
      await h.app.inject({
        url: "/api/poll-creation/context",
        headers: { cookie: withBallot },
      }),
      await h.app.inject({
        method: "POST",
        url: "/api/polls",
        headers: {
          cookie: withBallot,
          origin: ORIGIN,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        payload: JSON.stringify(question()),
      }),
      await h.app.inject({
        method: "PUT",
        url: `/api/posting-permissions/${ACCOUNTS.guest.id}`,
        headers: {
          cookie: withBallot,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        payload: JSON.stringify({ permission: "unlimited_posting" }),
      }),
      await h.app.inject({
        method: "DELETE",
        url: `/api/posting-permissions/${ACCOUNTS.guest.id}`,
        headers: { cookie: withBallot, origin: ORIGIN },
      }),
    ];
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [200, 201, 204, 204],
    );
    // And none of the refusals or answers in an ordinary run either.
    await h.publish(undefined, question());
    await h.publish("guest", question(), { origin: null });
    await h.context(undefined);
    for (const response of [...responses, ...h.seen])
      assert.equal(
        response.headers["set-cookie"],
        undefined,
        "a creation route set a cookie",
      );
  });

  it("no_response_or_log_line_carries_an_account_id_address_or_key", async (t) => {
    const h = await harness(t, kind);
    const keys = [randomUUID(), randomUUID()];
    await h.publish("guest", question(), { key: keys[0] as string });
    await h.publish("guest", question(), { key: keys[0] as string });
    await h.publish("guest", question({ question: "Changed" }), {
      key: keys[0] as string,
    });
    await h.publish(
      "member",
      question({ attribution: { kind: "named", name: "Ada" } }),
      {
        key: keys[1] as string,
      },
    );
    await h.publish("guest", question(), { key: "not-a-key-but-private" });
    await h.context("owner");
    await h.context("member");
    await h.grant("owner", ACCOUNTS.member.id);
    await h.revoke("owner", ACCOUNTS.member.id);
    await h.grant("member", ACCOUNTS.guest.id);
    await h.grant("owner", "no-such-account-zz");
    await h.publish(undefined, question());
    await h.publish("guest", question(), { origin: "https://evil.example" });

    const responses = h.seen
      .map((r) => `${JSON.stringify(r.headers)} ${r.body}`)
      .join("\n");
    const logs = h.logs.join("");
    assert.ok(
      logs.includes("/api/posting-permissions/:voterId"),
      "requests were not logged",
    );
    const secrets = [
      ...Object.values(ACCOUNTS).flatMap((a) => [a.id, a.email]),
      ...keys,
      "not-a-key-but-private",
      "no-such-account-zz",
    ];
    for (const secret of secrets) {
      assert.ok(!responses.includes(secret), `a response carried ${secret}`);
      assert.ok(!logs.includes(secret), `a log line carried ${secret}`);
    }
    // Bodies are not logged either.
    assert.ok(!logs.includes("community garden"), "a request body was logged");
  });
}

/**
 * The store's refusals and faults, each mapped through a store that throws
 * exactly that. The real stores reach most of these above; this pins the
 * mapping itself, including the ones a real store reaches only in a race.
 */
function throwing(error: unknown): CreationStore {
  const fail = () => Promise.reject(error);
  return { context: fail, publish: fail, setUnlimited: fail };
}

test("every_store_refusal_has_its_documented_status", async (t) => {
  const table: [unknown, number, string][] = [
    [new CreationError("bad_request"), 400, "bad_request"],
    // The store re-checks the generation in its transaction: a sign-out that
    // lands after the guard still wins.
    [new CreationError("signed_out"), 401, "signed_out"],
    [new CreationError("owner_required"), 403, "owner_required"],
    [new CreationError("not_found"), 404, "not_found"],
    [new CreationError("idempotency_conflict"), 409, "idempotency_conflict"],
    [new CreationError("purpose_required"), 422, "purpose_required"],
    [new CreationError("posting_limit", 42), 429, "posting_limit"],
    [
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      }),
      503,
      "creation_unavailable",
    ],
    [
      Object.assign(
        new Error("terminating connection due to administrator command"),
        { code: "57P01" },
      ),
      503,
      "creation_unavailable",
    ],
    [
      Object.assign(new Error("could not serialize access"), { code: "40001" }),
      503,
      "creation_unavailable",
    ],
    [
      Object.assign(new Error("sorry, too many clients already"), {
        code: "53300",
      }),
      503,
      "creation_unavailable",
    ],
    [
      new Error("Connection terminated unexpectedly"),
      503,
      "creation_unavailable",
    ],
    [
      new Error("timeout exceeded when trying to connect"),
      503,
      "creation_unavailable",
    ],
    [new TypeError("something nobody planned"), 500, "server_error"],
  ];
  for (const [error, status, slug] of table) {
    const h = await harness(t, "memory", { creationStore: throwing(error) });
    for (const response of [
      await h.context("owner"),
      await h.publish("owner", question()),
      await h.grant("owner", ACCOUNTS.guest.id),
      await h.revoke("owner", ACCOUNTS.guest.id),
    ]) {
      refused(response, status, slug);
      assert.equal(
        response.headers["retry-after"],
        slug === "posting_limit" ? "42" : undefined,
      );
    }
  }
});

test("a_database_fault_is_logged_without_its_detail", async (t) => {
  const fault = Object.assign(
    new Error('duplicate key value violates unique constraint "x"'),
    {
      code: "23505",
      severity: "ERROR",
      detail: `Key (voter_id, request_key)=(${ACCOUNTS.owner.id}, secret-key) already exists.`,
    },
  );
  const h = await harness(t, "memory", { creationStore: throwing(fault) });
  const response = await h.publish("owner", question());
  refused(response, 500, "server_error");
  assert.ok(!response.body.includes("duplicate"));
  const logs = h.logs.join("");
  assert.match(logs, /poll creation failed/);
  assert.match(logs, /23505/);
  assert.ok(!logs.includes(ACCOUNTS.owner.id));
  assert.ok(!logs.includes("secret-key"));
});

test("an_unplanned_fault_is_logged_with_its_message", async (t) => {
  const h = await harness(t, "memory", {
    creationStore: throwing(new Error("posting community is not configured")),
  });
  refused(await h.context("owner"), 500, "server_error");
  assert.match(h.logs.join(""), /posting community is not configured/);
});

test("an_unreachable_database_is_creation_unavailable", async (t) => {
  // Port 1 refuses at once; nothing is listening and nothing is created.
  const pool = createPool({
    connectionString: "postgres://pulse@127.0.0.1:1/pulse",
  });
  t.after(() => pool.end());
  const h = await harness(t, "memory", {
    creationStore: new PostgresCreationStore(pool),
  });
  refused(await h.context("guest"), 503, "creation_unavailable");
  refused(await h.publish("guest", question()), 503, "creation_unavailable");
  refused(
    await h.grant("owner", ACCOUNTS.guest.id),
    503,
    "creation_unavailable",
  );
});

test("without_a_creation_store_every_route_is_unavailable", async (t) => {
  const h = await harness(t, "memory", { creationStore: null });
  refused(await h.context("guest"), 503, "creation_unavailable");
  refused(await h.publish("guest", question()), 503, "creation_unavailable");
  refused(
    await h.grant("owner", ACCOUNTS.guest.id),
    503,
    "creation_unavailable",
  );
  refused(
    await h.revoke("owner", ACCOUNTS.guest.id),
    503,
    "creation_unavailable",
  );
  // Said first, before origin or session: there is nothing to sign in for,
  // and no account is looked up for a feature that is switched off.
  refused(await h.context(undefined), 503, "creation_unavailable");
  refused(
    await h.publish(undefined, question(), { origin: null }),
    503,
    "creation_unavailable",
  );
});

test("without_a_configured_web_origin_every_mutation_is_refused", async (t) => {
  const h = await harness(t, "memory", { noWebOrigin: true });
  refused(await h.publish("guest", question()), 403, "origin_not_allowed");
  refused(await h.grant("owner", ACCOUNTS.guest.id), 403, "origin_not_allowed");
  refused(
    await h.revoke("owner", ACCOUNTS.guest.id),
    403,
    "origin_not_allowed",
  );
  // Reading needs no origin.
  assert.equal((await h.context("guest")).statusCode, 200);
});

test("a_forwarded_host_or_origin_header_does_not_stand_in_for_origin", async (t) => {
  const h = await harness(t, "memory", { trustProxy: 1 });
  const response = await h.app.inject({
    method: "POST",
    url: "/api/polls",
    remoteAddress: "10.0.0.2",
    headers: {
      cookie: h.cookie("guest"),
      host: "pulse.example.org",
      "x-forwarded-host": "pulse.example.org",
      "x-forwarded-proto": "https",
      referer: `${ORIGIN}/new`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    payload: JSON.stringify(question()),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "origin_not_allowed");
});

test("every_creation_route_is_rate_limited_per_client_and_refusals_count", async (t) => {
  const h = await harness(t, "memory", {
    creationRateLimit: { max: 3, timeWindow: "1 minute" },
  });
  // Refused requests are counted too: a signed-out caller and a foreign
  // origin each use up the allowance before any account is looked up.
  refused(await h.publish(undefined, question()), 401, "signed_out");
  refused(
    await h.publish("guest", question(), { origin: "https://evil.test" }),
    403,
    "origin_not_allowed",
  );
  const key = randomUUID();
  assert.equal((await h.publish("guest", question(), { key })).statusCode, 201);
  const limited = await h.publish("guest", question(), { key });
  refused(limited, 429, "too_many_requests");
  assert.notEqual(
    limited.json().error,
    "posting_limit",
    "the request limit is not the posting quota",
  );

  for (let i = 0; i < 3; i += 1) await h.context(undefined);
  refused(await h.context("guest"), 429, "too_many_requests");
  for (let i = 0; i < 3; i += 1) await h.grant(undefined, ACCOUNTS.guest.id);
  refused(await h.grant("owner", ACCOUNTS.guest.id), 429, "too_many_requests");
  for (let i = 0; i < 3; i += 1) await h.revoke(undefined, ACCOUNTS.guest.id);
  refused(await h.revoke("owner", ACCOUNTS.guest.id), 429, "too_many_requests");
});

test("the_default_request_limit_still_lets_the_posting_quota_answer", async (t) => {
  const h = await harness(t, "memory");
  for (let i = 0; i < 5; i += 1)
    assert.equal((await h.publish("guest", question())).statusCode, 201);
  refused(await h.publish("guest", question()), 429, "posting_limit");
});
