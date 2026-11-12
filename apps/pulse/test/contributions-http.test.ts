import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PostgresContributionsStore } from "../src/contributions/pg-store.js";
import type {
  ContributionsStore,
  MutationResult,
} from "../src/contributions/store.js";
import { createServer } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  PostgresClaimStore,
  PostgresVoterStore,
} from "../src/identity/pg-store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

test(
  "Postgres contribution routes enforce privacy and replay contracts over HTTP",
  {
    skip: databaseSkip,
  },
  async (t) => {
    const pool = await migratedSchema(t);
    const voters = new PostgresVoterStore(pool);
    const votes = new PostgresVotingStore(pool);
    const webOrigin = "https://pulse.test";
    const signer = new SessionSigner(
      "contributions-http-test-secret-long-enough",
    );
    const app = await createServer({
      voters,
      votes,
      signer,
      webOrigin,
      suggestions: new InMemorySuggestionStore(),
      contributions: new PostgresContributionsStore(pool),
      claims: new ClaimService({
        membership: new DomainAllowlist(new StaticDomainSource([])),
        voters,
        claims: new PostgresClaimStore(pool),
        mailer: new ConsoleMailer(() => {}),
        linkFor: () => webOrigin,
      }),
    });
    t.after(() => app.close());
    const server = await app.listen({ port: 0, host: "127.0.0.1" });
    const organizer = "private-organizer";
    const sender = "private-sender";
    for (const id of [organizer, sender]) {
      const now = new Date();
      await voters.create(
        {
          id,
          community: null,
          assurance: "email",
          claimedAt: now,
          proofEmailsOptIn: false,
        },
        { kind: "email", value: `${id}@example.test`, verifiedAt: now },
      );
    }
    const root = `${server}/api/contributions`;
    const cookie = (id: string) => `${SESSION_COOKIE}=${signer.sign(id, 0)}`;
    function post(
      url: string,
      body: object,
      actor?: string,
      key = randomUUID(),
      origin = webOrigin,
    ) {
      return fetch(url, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "idempotency-key": key,
          ...(actor ? { cookie: cookie(actor) } : {}),
        },
        body: JSON.stringify(body),
      });
    }

    const project = {
      kind: "project",
      title: "Plant a community garden",
      description: "Build two shared garden beds.",
      organizerName: "Garden group",
    };
    assert.equal((await post(root, project)).status, 401);
    const publishKey = randomUUID();
    const forbidden = await post(
      root,
      project,
      organizer,
      publishKey,
      "https://elsewhere.test",
    );
    assert.equal(forbidden.status, 403);
    assert.equal(
      ((await forbidden.json()) as { error: string }).error,
      "origin_not_allowed",
    );

    const createdResponse = await post(root, project, organizer, publishKey);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as MutationResult;
    assert.equal(created.replayed, false);
    const detailUrl = `${root}/${created.contribution.id}`;
    const inboxUrl = `${detailUrl}/messages`;

    const message = "Can I bring tools on Saturday?";
    const messageKey = randomUUID();
    assert.equal((await post(inboxUrl, { message })).status, 401);
    const sentResponse = await post(inboxUrl, { message }, sender, messageKey);
    assert.equal(sentResponse.status, 201);
    const sent = (await sentResponse.json()) as Awaited<
      ReturnType<ContributionsStore["sendMessage"]>
    >;
    assert.equal(sent.replayed, false);
    const retry = await post(inboxUrl, { message }, sender, messageKey);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { ...sent, replayed: true });
    assert.equal(
      (await post(inboxUrl, { message: "Different text" }, sender, messageKey))
        .status,
      409,
    );

    const update = { status: "completed", message: "Garden beds are ready." };
    assert.equal(
      (await post(`${detailUrl}/updates`, update, sender)).status,
      403,
    );
    assert.equal(
      (await post(`${detailUrl}/updates`, update, organizer)).status,
      201,
    );
    const replay = await post(root, project, organizer, publishKey);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ...created, replayed: true });

    assert.equal((await fetch(inboxUrl)).status, 401);
    assert.equal(
      (await fetch(inboxUrl, { headers: { cookie: cookie(sender) } })).status,
      403,
    );
    const inbox = await fetch(inboxUrl, {
      headers: { cookie: cookie(organizer) },
    });
    assert.equal(inbox.status, 200);
    assert.equal(inbox.headers.get("cache-control"), "no-store");
    const { messages } = (await inbox.json()) as Awaited<
      ReturnType<ContributionsStore["messages"]>
    >;
    assert.deepEqual(messages, [
      { id: sent.id, message, createdAt: messages[0]?.createdAt },
    ]);

    assert.ok(Number.isFinite(Date.parse(messages[0]!.createdAt)));

    const detail = await fetch(detailUrl);
    assert.equal(detail.status, 200);
    const publicRecord = (await detail.json()) as Awaited<
      ReturnType<ContributionsStore["detail"]>
    >;
    assert.equal(publicRecord.canManage, false);
    assert.equal(publicRecord.contribution.status, "completed");
    const list = await fetch(root);
    assert.equal(list.status, 200);
    const publicList = (await list.json()) as Awaited<
      ReturnType<ContributionsStore["list"]>
    >;
    assert.deepEqual(
      publicList.contributions.map((item) => item.id),
      [created.contribution.id],
    );
    for (const privateValue of [message, sender, organizer, sent.id]) {
      assert.ok(
        !JSON.stringify([publicRecord, publicList]).includes(privateValue),
      );
    }

    await votes.createPoll({
      id: "hidden-poll",
      question: "Where should the garden go?",
      choices: ["North", "South"],
      method: "single",
    });
    await pool.query("update polls set hidden = true where id = $1", [
      "hidden-poll",
    ]);
    for (const pollId of ["missing-poll", "hidden-poll"]) {
      const response = await post(root, { ...project, pollId }, organizer);
      assert.equal(response.status, 404);
      assert.equal(
        ((await response.json()) as { error: string }).error,
        "poll_not_found",
      );
    }
  },
);
