import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { databaseSkip } from "./support/database.js";
import {
  fixture,
  response,
  errorResponse,
  mutationSchema,
  detailSchema,
  pageSchema,
  messageSchema,
  inboxSchema,
  project,
  participation,
  update,
  message,
  organizer,
  sender,
  webOrigin,
} from "./support/contributions-http.js";

const options = { skip: databaseSkip };
const writes = (id: string) => [
  { name: "create", path: "", body: project },
  { name: "participate", path: `/${id}/participations`, body: participation },
  { name: "update", path: `/${id}/updates`, body: update },
  { name: "message", path: `/${id}/messages`, body: message },
];
const reads = (id: string) => ["", `/${id}`, `/${id}/messages`];

test(
  "Postgres HTTP contributions publish, participate, update, replay and keep inboxes private",
  options,
  async (t) => {
    const f = await fixture(t);
    const createKey = randomUUID();
    const created = await response(
      await f.post("", project, organizer, createKey),
      201,
      mutationSchema,
    );
    assert.equal(created.replayed, false);
    const id = created.contribution.id;
    const detail = await response(
      await f.get(`/${id}`, organizer),
      200,
      detailSchema,
    );
    assert.equal(detail.canManage, true);
    assert.deepEqual(detail.contribution, created.contribution);

    const participateKey = randomUUID();
    const joined = await response(
      await f.post(
        `/${id}/participations`,
        participation,
        sender,
        participateKey,
      ),
      201,
      mutationSchema,
    );
    assert.equal(joined.replayed, false);
    assert.deepEqual(joined.contribution.participations, [
      {
        ...participation,
        id: joined.contribution.participations[0]!.id,
        createdAt: joined.contribution.participations[0]!.createdAt,
      },
    ]);
    assert.deepEqual(
      (
        await f.pool.query(
          "select public_record from contribution where id=$1",
          [id],
        )
      ).rows[0]!.public_record,
      joined.contribution,
    );

    const updateKey = randomUUID();
    const changed = await response(
      await f.post(`/${id}/updates`, update, organizer, updateKey),
      201,
      mutationSchema,
    );
    assert.equal(changed.replayed, false);
    assert.equal(changed.contribution.status, "in_progress");
    assert.deepEqual(changed.contribution.updates, [
      {
        ...update,
        id: changed.contribution.updates[0]!.id,
        createdAt: changed.contribution.updates[0]!.createdAt,
      },
    ]);

    const messageKey = randomUUID();
    const sent = await response(
      await f.post(`/${id}/messages`, message, sender, messageKey),
      201,
      messageSchema,
    );
    assert.equal(sent.replayed, false);
    const beforeReplay = await f.snapshot();
    for (const [path, body, actor, key, original, schema] of [
      ["", project, organizer, createKey, created, mutationSchema],
      [
        `/${id}/participations`,
        participation,
        sender,
        participateKey,
        joined,
        mutationSchema,
      ],
      [`/${id}/updates`, update, organizer, updateKey, changed, mutationSchema],
    ] as const) {
      assert.deepEqual(
        await response(await f.post(path, body, actor, key), 200, schema),
        { ...original, replayed: true },
      );
      await f.rejects(
        () =>
          f.post(
            path,
            { ...body, message: "Changed", title: "Changed" },
            actor,
            key,
          ),
        400,
        "bad_request",
      );
    }
    assert.deepEqual(
      await response(
        await f.post(`/${id}/messages`, message, sender, messageKey),
        200,
        messageSchema,
      ),
      { ...sent, replayed: true },
    );
    assert.deepEqual(await f.snapshot(), beforeReplay);
    // Changed valid bodies, cross-operation and cross-target key reuse all conflict.
    for (const [path, body, actor, key] of [
      ["", { ...project, title: "Different" }, organizer, createKey],
      [
        `/${id}/participations`,
        { ...participation, message: "Different" },
        sender,
        participateKey,
      ],
      [
        `/${id}/updates`,
        { ...update, status: "completed" },
        organizer,
        updateKey,
      ],
      [`/${id}/messages`, { message: "Different" }, sender, messageKey],
      [`/${id}/updates`, update, organizer, createKey],
      [
        `/${randomUUID()}/participations`,
        participation,
        sender,
        participateKey,
      ],
    ] as const)
      await f.rejects(
        () => f.post(path, body, actor, key),
        409,
        "idempotency_conflict",
      );

    await f.rejects(() => f.get(`/${id}/messages`), 401, "signed_out");
    await f.rejects(
      () => f.get(`/${id}/messages`, sender),
      403,
      "organizer_required",
    );
    await f.rejects(
      () => f.post(`/${id}/updates`, update, sender),
      403,
      "organizer_required",
    );
    const inbox = await response(
      await f.get(`/${id}/messages`, organizer),
      200,
      inboxSchema,
    );
    assert.deepEqual(inbox.messages, [
      {
        id: sent.id,
        message: message.message,
        createdAt: inbox.messages[0]!.createdAt,
      },
    ]);
    const publicDetail = await response(
      await f.get(`/${id}`),
      200,
      detailSchema,
    );
    assert.equal(publicDetail.canManage, false);
    const list = await response(await f.get(), 200, pageSchema);
    assert.deepEqual(
      list.contributions.map((item) => item.id),
      [id],
    );
    assert.equal(list.nextCursor, null);
    for (const privateValue of [
      organizer,
      sender,
      message.message,
      sent.id,
      createKey,
      participateKey,
      updateKey,
      messageKey,
    ])
      assert.ok(!JSON.stringify([publicDetail, list]).includes(privateValue));
    assert.equal(
      (await f.pool.query("select count(*) from vote")).rows[0]!.count,
      "0",
    );
  },
);

for (const operation of ["create", "participate", "update", "message"]) {
  test(
    `Postgres HTTP ${operation} rejects malformed bodies, keys, origins and unauthenticated requests without writes`,
    options,
    async (t) => {
      const f = await fixture(t);
      const record = await f.create();
      const { path, body } = writes(record.id).find(
        (item) => item.name === operation,
      )!;
      for (const raw of [null, [], {}, { ...body, unexpected: true }])
        await f.rejects(() => f.post(path, raw), 400, "bad_request");
      for (const key of [null, "", "not-a-uuid"])
        await f.rejects(
          () => f.post(path, body, organizer, key),
          400,
          "bad_request",
        );
      for (const origin of ["", "https://elsewhere.test"])
        await f.rejects(
          () => f.post(path, body, organizer, randomUUID(), { origin }),
          403,
          "origin_not_allowed",
        );
      await f.rejects(() => f.post(path, body, null), 401, "signed_out");
      await f.rejects(
        () =>
          f.post(path, body, organizer, randomUUID(), {
            cookie: "pulse_session=forged",
          }),
        401,
        "signed_out",
      );
      await f.rejects(
        () =>
          f.post(path, body, organizer, randomUUID(), {
            "content-type": "text/plain",
          }),
        400,
        "bad_request",
      );
      for (const raw of [
        "{",
        '{"__proto__":{}}',
        Buffer.from([0x22, 0xff, 0x22]),
      ]) {
        await f.rejects(
          () =>
            fetch(`${f.root}${path}`, {
              method: "POST",
              headers: {
                origin: webOrigin,
                cookie: f.cookie(organizer),
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
              },
              body: raw,
            }),
          400,
          "bad_request",
        );
      }
      await f.rejects(
        () => f.post(path, { ...body, message: "x".repeat(33 * 1024) }),
        413,
        "body_too_large",
      );
      // Guards run before parsing, even for an oversized/invalid body.
      await f.rejects(
        () => f.post(path, { message: "x".repeat(33 * 1024) }, null),
        401,
        "signed_out",
      );
      await f.rejects(
        () =>
          f.post(
            path,
            { message: "x".repeat(33 * 1024) },
            organizer,
            randomUUID(),
            { origin: "https://elsewhere.test" },
          ),
        403,
        "origin_not_allowed",
      );
    },
  );
}

test(
  "Postgres HTTP validates contribution fields and linked visible polls",
  options,
  async (t) => {
    const f = await fixture(t);
    for (const body of [
      { ...project, title: " " },
      { ...project, title: "x".repeat(161) },
      { ...project, description: "x".repeat(4001) },
      { ...project, organizerName: "x".repeat(81) },
      { ...project, kind: "investment" },
      { ...project, needs: "x".repeat(2001) },
      { ...project, communityBenefit: "x".repeat(2001) },
      { ...project, description: "bad\u0000text" },
      { ...project, title: "\ud800" },
      {
        ...project,
        kind: "offer",
        commercial: {
          currency: "CAD",
          regularPriceMinor: 100,
          offeredPriceMinor: 81,
          referenceUrl: "https://example.test",
          terms: "Unverified",
        },
      },
      { ...project, fund: { name: "Fund", percentage: 10 } },
    ])
      await f.rejects(() => f.post("", body), 400, "bad_request");
    await f.votes.createPoll({
      id: "hidden-poll",
      question: "Where?",
      choices: ["North", "South"],
      method: "single",
    });
    await f.pool.query("update polls set hidden=true where id=$1", [
      "hidden-poll",
    ]);
    for (const pollId of ["missing-poll", "hidden-poll"])
      await f.rejects(
        () => f.post("", { ...project, pollId }),
        404,
        "poll_not_found",
      );
    await f.pool.query("update polls set hidden=false where id=$1", [
      "hidden-poll",
    ]);
    const linked = await response(
      await f.post("", { ...project, pollId: "hidden-poll" }),
      201,
      mutationSchema,
    );
    assert.equal(linked.contribution.pollId, "hidden-poll");
  },
);

test(
  "Postgres HTTP validates participation, status and evidence fields",
  options,
  async (t) => {
    const f = await fixture(t);
    const { id } = await f.create();
    for (const body of [
      { ...participation, kind: "buy" },
      { ...participation, displayName: " " },
      { ...participation, displayName: "x".repeat(81) },
      { ...participation, message: "x".repeat(2001) },
    ])
      await f.rejects(
        () => f.post(`/${id}/participations`, body),
        400,
        "bad_request",
      );
    for (const body of [
      { ...update, status: "verified" },
      { ...update, message: " " },
      { ...update, message: "x".repeat(2001) },
      ...[
        "javascript:alert(1)",
        "https://user:pass@example.test",
        "https://example.test/" + "x".repeat(2000),
      ].map((evidenceUrl) => ({ ...update, evidenceUrl })),
    ])
      await f.rejects(() => f.post(`/${id}/updates`, body), 400, "bad_request");
    for (const body of [{ message: " " }, { message: "x".repeat(2001) }])
      await f.rejects(
        () => f.post(`/${id}/messages`, body),
        400,
        "bad_request",
      );
  },
);

test(
  "Postgres HTTP unknown IDs and malformed list cursors return documented errors",
  options,
  async (t) => {
    const f = await fixture(t);
    const missing = randomUUID();
    for (const path of [
      `/${missing}`,
      `/${missing}/messages`,
      "/not-an-id",
      "/not-an-id/messages",
    ])
      await f.rejects(() => f.get(path, organizer), 404, "not_found");
    for (const { path, body } of [
      ...writes(missing).slice(1),
      ...writes("not-an-id").slice(1),
    ])
      await f.rejects(() => f.post(path, body), 404, "not_found");
    for (const query of [
      "?cursor=",
      "?cursor=invalid",
      "?cursor=a&cursor=b",
      "?extra=true",
      `?cursor=${"a".repeat(1025)}`,
      `?cursor=${Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: missing })).toString("base64url")}`,
    ])
      await f.rejects(() => f.get(query), 400, "bad_request");
  },
);

test(
  "Postgres HTTP sign-out revokes cookies on all writes and the organizer inbox while public reads remain public",
  options,
  async (t) => {
    const f = await fixture(t);
    const { id } = await f.create();
    const signedOut = await fetch(`${f.server}/api/sign-out`, {
      method: "POST",
      headers: { origin: webOrigin, cookie: f.cookie(organizer) },
    });
    assert.equal(signedOut.status, 200);
    for (const { path, body } of writes(id))
      await f.rejects(() => f.post(path, body), 401, "signed_out");
    await f.rejects(
      () => f.get(`/${id}/messages`, organizer),
      401,
      "signed_out",
    );
    assert.equal(
      (await response(await f.get(`/${id}`, organizer), 200, detailSchema))
        .canManage,
      false,
    );
    await response(await f.get("", organizer), 200, pageSchema);
  },
);

test(
  "Postgres HTTP closure rejects help and pledges, permits reports, and allows organizer reopening",
  options,
  async (t) => {
    const f = await fixture(t);
    const { id } = await f.create();
    for (const status of ["completed", "cancelled"]) {
      await response(
        await f.post(`/${id}/updates`, { message: "Closed", status }),
        201,
        mutationSchema,
      );
      for (const kind of ["help", "pledge"])
        await f.rejects(
          () =>
            f.post(`/${id}/participations`, { ...participation, kind }, sender),
          409,
          "closed",
        );
      const report = await response(
        await f.post(
          `/${id}/participations`,
          { ...participation, kind: "report" },
          sender,
        ),
        201,
        mutationSchema,
      );
      assert.equal(report.contribution.participations.at(-1)!.kind, "report");
    }
    await response(
      await f.post(`/${id}/updates`, { message: "Reopened", status: "open" }),
      201,
      mutationSchema,
    );
    const pledge = await response(
      await f.post(
        `/${id}/participations`,
        { ...participation, kind: "pledge" },
        sender,
      ),
      201,
      mutationSchema,
    );
    assert.equal(pledge.contribution.participations.at(-1)!.kind, "pledge");
  },
);

for (const kind of ["participations", "messages"] as const) {
  test(
    `Postgres HTTP ${kind} enforce the sender cap without counting retries`,
    options,
    async (t) => {
      const f = await fixture(t);
      const { id } = await f.create();
      const path = `/${id}/${kind}`;
      const body = kind === "messages" ? message : participation;
      const key = randomUUID();
      if (kind === "messages") {
        const sent = await response(
          await f.post(path, body, sender, key),
          201,
          messageSchema,
        );
        assert.deepEqual(
          await response(
            await f.post(path, body, sender, key),
            200,
            messageSchema,
          ),
          { ...sent, replayed: true },
        );
      } else {
        const joined = await response(
          await f.post(path, body, sender, key),
          201,
          mutationSchema,
        );
        assert.deepEqual(
          await response(
            await f.post(path, body, sender, key),
            200,
            mutationSchema,
          ),
          { ...joined, replayed: true },
        );
      }
      for (let i = 1; i < 20; i++) {
        const res = await f.post(
          path,
          { ...body, message: `Entry ${i}` },
          sender,
        );
        if (kind === "messages") await response(res, 201, messageSchema);
        else await response(res, 201, mutationSchema);
      }
      await f.rejects(() => f.post(path, body, sender), 409, "sender_limit");
      // Another account can still add an entry to this record.
      const res = await f.post(path, body);
      if (kind === "messages") await response(res, 201, messageSchema);
      else await response(res, 201, mutationSchema);
    },
  );
}

for (const kind of ["participations", "updates", "messages"] as const) {
  test(
    `Postgres HTTP ${kind} enforce the shared 500-entry cap atomically`,
    options,
    async (t) => {
      const f = await fixture(t);
      const record = await f.create();
      const entries = Array.from({ length: 500 }, () => ({
        id: randomUUID(),
        createdAt: record.createdAt,
        ...(kind === "participations"
          ? participation
          : kind === "updates"
            ? update
            : { ...message, senderId: sender, key: randomUUID() }),
      }));
      // Seed the boundary directly; 500 HTTP writes would test rate limits instead.
      if (kind === "messages")
        await f.pool.query(
          "update contribution set private_messages=$2 where id=$1",
          [record.id, JSON.stringify(entries)],
        );
      else
        await f.pool.query(
          "update contribution set public_record=jsonb_set(public_record, $2::text[], $3::jsonb) where id=$1",
          [record.id, [kind], JSON.stringify(entries)],
        );
      const body =
        kind === "participations"
          ? participation
          : kind === "updates"
            ? update
            : message;
      await f.rejects(
        () => f.post(`/${record.id}/${kind}`, body),
        409,
        "record_full",
      );
    },
  );
}

test(
  "Postgres HTTP publishing enforces five contributions per rolling hour",
  options,
  async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < 5; i++) await f.create();
    await f.rejects(() => f.post("", project), 429, "posting_limit");
  },
);

for (const route of [
  "list",
  "detail",
  "inbox",
  "create",
  "participate",
  "update",
  "message",
]) {
  test(
    `Postgres HTTP ${route} enforces its per-route IP rate limit`,
    options,
    async (t) => {
      const f = await fixture(t);
      const { id } = await f.create();
      const readPath =
        route === "list"
          ? ""
          : route === "detail"
            ? `/${id}`
            : `/${id}/messages`;
      const write = writes(id).find((item) => item.name === route);
      // Invalid keys consume the route limit but never mutate data or hit account quotas.
      const request = write
        ? () => f.post(write.path, write.body, organizer, "invalid")
        : () => f.get(readPath, organizer);
      const allowance = write ? (route === "create" ? 29 : 30) : 120;
      for (let i = 0; i < allowance; i++) {
        if (write) await f.rejects(request, 400, "bad_request");
        else {
          const res = await request();
          if (route === "list") await response(res, 200, pageSchema);
          else if (route === "detail") await response(res, 200, detailSchema);
          else await response(res, 200, inboxSchema);
        }
      }
      await f.rejects(request, 429, "too_many_requests");
      // Exhausting this route does not exhaust another route.
      if (route !== "detail")
        await response(await f.get(`/${id}`), 200, detailSchema);
      else await response(await f.get(), 200, pageSchema);
    },
  );
}

for (const storage of ["missing", "disconnected"] as const) {
  test(
    `Postgres HTTP all contribution routes return 503 with ${storage} storage`,
    options,
    async (t) => {
      const f = await fixture(t, storage !== "missing");
      const id = storage === "missing" ? randomUUID() : (await f.create()).id;
      if (storage === "disconnected") await f.stopStorage();
      for (const path of reads(id))
        await f.rejects(
          () => f.get(path, organizer),
          503,
          "contributions_unavailable",
        );
      for (const { path, body } of writes(id))
        await f.rejects(
          () => f.post(path, body),
          503,
          "contributions_unavailable",
        );
    },
  );
}

for (const [sqlstate, code, error] of [
  ["53000", 503, "contributions_unavailable"],
  ["P0001", 500, "server_error"],
] as const) {
  test(
    `Postgres HTTP ${error} rolls back records and replay keys after a late database failure`,
    options,
    async (t) => {
      const f = await fixture(t);
      const { id } = await f.create();
      // The trigger fails after save(), during remember(): the transaction must
      // undo the preceding INSERT/UPDATE as well as avoid spending the key.
      await f.pool.query(
        `create function refuse_replay() returns trigger language plpgsql as $$ begin raise exception 'private database detail' using errcode = '${sqlstate}'; end $$`,
      );
      await f.pool.query(
        "create trigger refuse_replay before insert on contribution_replay for each row execute function refuse_replay()",
      );
      const attempts = writes(id).map((entry) => ({
        ...entry,
        key: randomUUID(),
      }));
      for (const { path, body, key } of attempts.slice(0, 3)) {
        await f.rejects(() => f.post(path, body, organizer, key), code, error);
      }
      // Messages do not write contribution_replay; fail their UPDATE instead.
      await f.pool.query(
        `create trigger refuse_message before update on contribution for each row execute function refuse_replay()`,
      );
      const failedMessage = attempts[3]!;
      await f.rejects(
        () =>
          f.post(
            failedMessage.path,
            failedMessage.body,
            organizer,
            failedMessage.key,
          ),
        code,
        error,
      );
      await f.pool.query("drop trigger refuse_message on contribution");
      await f.pool.query("drop trigger refuse_replay on contribution_replay");
      for (const { name, path, body, key } of attempts) {
        const res = await f.post(path, body, organizer, key);
        if (name === "message") await response(res, 201, messageSchema);
        else await response(res, 201, mutationSchema);
      }
    },
  );
}

test(
  "Postgres HTTP list pagination validates summaries and visits all records once",
  options,
  async (t) => {
    const f = await fixture(t);
    const record = await f.create();
    for (let i = 0; i < 21; i++) {
      const item = {
        ...record,
        id: randomUUID(),
        createdAt: new Date(Date.now() - (i + 1) * 1000).toISOString(),
      };
      await f.pool.query(
        "insert into contribution (id, owner_id, created_at, public_record) values ($1,$2,$3,$4)",
        [item.id, organizer, item.createdAt, JSON.stringify(item)],
      );
    }
    const before = await f.snapshot();
    const first = await response(await f.get(), 200, pageSchema);
    assert.equal(first.contributions.length, 20);
    assert.ok(first.nextCursor);
    const second = await response(
      await f.get(`?cursor=${encodeURIComponent(first.nextCursor)}`),
      200,
      pageSchema,
    );
    assert.equal(second.contributions.length, 2);
    assert.equal(second.nextCursor, null);
    const all = [...first.contributions, ...second.contributions];
    assert.equal(new Set(all.map((item) => item.id)).size, 22);
    assert.deepEqual(
      all.map((item) => item.createdAt),
      all
        .map((item) => item.createdAt)
        .sort()
        .reverse(),
    );
    assert.deepEqual(await f.snapshot(), before);
  },
);

test(
  "Postgres HTTP reads return a private generic 500 for unexpected database faults",
  options,
  async (t) => {
    const f = await fixture(t);
    const { id } = await f.create();
    const before = await f.snapshot();
    // A real database failure on SELECT, isolated to this test's schema. The
    // replay foreign key follows the renamed table and is restored with it.
    await f.pool.query("alter table contribution rename to contribution_saved");
    try {
      await f.pool.query(
        `create function fail_read(jsonb) returns jsonb language plpgsql as $$ begin raise exception 'private database detail'; end $$`,
      );
      await f.pool.query(
        `create view contribution as select id, owner_id, created_at, fail_read(public_record) as public_record, private_messages from contribution_saved`,
      );
      for (const path of reads(id)) {
        const body = await errorResponse(
          await f.get(path, organizer),
          500,
          "server_error",
        );
        assert.ok(!body.message.includes("private database detail"));
      }
    } finally {
      await f.pool.query("drop view if exists contribution");
      await f.pool.query(
        "alter table contribution_saved rename to contribution",
      );
    }
    assert.deepEqual(await f.snapshot(), before);
  },
);

for (const route of ["create", "participate", "update", "message"]) {
  test(
    `Postgres HTTP ${route} refuses another account or a missing accountId without writes`,
    options,
    async (t) => {
      const f = await fixture(t);
      const item = await f.create();
      const write = writes(item.id).find((entry) => entry.name === route)!;
      // The current session is authorized even for organizer updates. The
      // draft belongs to someone else, so authorization alone cannot protect it.
      for (const accountId of [sender, undefined, null, "", 42]) {
        await f.rejects(
          () => f.post(write.path, { ...write.body, accountId }, organizer),
          accountId === sender ? 409 : 400,
          accountId === sender ? "account_changed" : "bad_request",
        );
      }
      // A stale attempt must not claim this account's request key.
      const key = randomUUID();
      await f.rejects(
        () =>
          f.post(
            write.path,
            { ...write.body, accountId: sender },
            organizer,
            key,
          ),
        409,
        "account_changed",
      );
      const accepted = await f.post(write.path, write.body, organizer, key);
      if (route === "message") await response(accepted, 201, messageSchema);
      else await response(accepted, 201, mutationSchema);
      await f.rejects(
        () =>
          f.post(
            write.path,
            { ...write.body, accountId: sender },
            organizer,
            key,
          ),
        409,
        "account_changed",
      );
    },
  );
}
