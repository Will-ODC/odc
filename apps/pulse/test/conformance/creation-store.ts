import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import {
  HOUR_MS,
  PURPOSE_VERSION,
  WEEK_MS,
} from "../../src/authoring/input.js";
import type {
  CreationOptions,
  CreationStore,
  PublicationActor,
} from "../../src/authoring/store.js";
import type { VoterStore } from "../../src/identity/store.js";
import type { VotingStore } from "../../src/voting/store.js";

export const AT = new Date("2026-10-14T12:00:00.123Z");
export const member: PublicationActor = {
  voterId: "member-private",
  sessionGeneration: 0,
};
export const owner: PublicationActor = {
  voterId: "owner-account",
  sessionGeneration: 0,
};
const guest: PublicationActor = {
  voterId: "guest-account",
  sessionGeneration: 0,
};
export const body = {
  question: " Q ",
  choices: [" A ", " B "],
  method: "single",
  purposeAcknowledgement: PURPOSE_VERSION,
};
interface Fixture {
  store: CreationStore;
  other: CreationStore;
  voters: VoterStore;
  voting: VotingStore;
  make(options: CreationOptions): CreationStore;
  setTime(time: Date): void;
}
export function creationConformance(
  name: string,
  fresh: (t: TestContext) => Promise<Fixture>,
  skip: string | false = false,
) {
  const check = (behavior: string, run: (f: Fixture) => Promise<void>) =>
    test(`${name}: ${behavior}`, { skip }, async (t) => run(await fresh(t)));

  check(
    "publishes_private_author_public_projection_and_independent_ballots",
    async ({ store, voting }) => {
      const { poll } = await store.publish(member, randomUUID(), {
        ...body,
        method: "approval",
      });
      assert.deepEqual(poll, {
        id: poll.id,
        question: "Q",
        choices: ["A", "B"],
        method: "approval",
        next: [null, null],
        acceptsSuggestions: false,
        closesAt: new Date(AT.getTime() + WEEK_MS).toISOString(),
        open: true,
        community: { id: "campus", label: "Campus" },
        attribution: { kind: "anonymous" },
      });
      assert.doesNotMatch(
        JSON.stringify(poll),
        /member-private|example.test|created_by|voterId|request_key/,
      );
      assert.equal((await voting.results(poll.id)).voters, 0);
      assert.equal(
        (await voting.castVote(poll.id, "browser-ballot", [0, 1])).status,
        "counted",
      );
      assert.equal((await voting.results(poll.id)).voters, 1);
      assert.equal((await voting.results(poll.id)).confirmedVoters, 0);
      assert.deepEqual(
        (await voting.voteOf(poll.id, "browser-ballot"))?.choices,
        [0, 1],
      );
      assert.equal(await voting.voteOf(poll.id, member.voterId), undefined);
    },
  );

  check(
    "uses_General_without_joining_and_named_attribution_is_explicit",
    async ({ store, voters }) => {
      const closesAt = new Date(AT.getTime() + 1000).toISOString();
      const { poll } = await store.publish(guest, randomUUID(), {
        ...body,
        closesAt,
        attribution: { kind: "named", name: " Ada " },
      });
      assert.deepEqual(poll.community, {
        id: "pulse-general",
        label: "General",
      });
      assert.deepEqual(poll.attribution, { kind: "named", name: "Ada" });
      assert.equal(poll.closesAt, closesAt);
      assert.equal((await voters.byId(guest.voterId))?.community, null);
    },
  );

  check(
    "requires_promise_and_failed_writes_do_not_acknowledge_or_charge_quota",
    async ({ store, make, voting }) => {
      const without = { question: "Q", choices: ["A", "B"], method: "single" };
      await assert.rejects(store.publish(member, randomUUID(), without), {
        message: "purpose_required",
      });
      await assert.rejects(
        store.publish(member, randomUUID(), {
          ...body,
          closesAt: AT.toISOString(),
        }),
        { message: "bad_request" },
      );
      await assert.rejects(
        store.publish(member, randomUUID(), {
          ...body,
          created_by: owner.voterId,
        }),
        { message: "bad_request" },
      );
      await voting.createPoll({
        id: "collision",
        question: "Unrelated seed",
        choices: ["A", "B"],
        method: "single",
      });
      const key = randomUUID();
      await assert.rejects(
        make({ newId: () => "collision" }).publish(member, key, body),
      );
      assert.equal((await store.context(member)).purposeAcknowledged, false);
      assert.equal((await store.publish(member, key, body)).replayed, false);
      assert.equal((await store.context(member)).purposeAcknowledged, true);
      for (let i = 0; i < 4; i++)
        await store.publish(member, randomUUID(), without);
      await assert.rejects(store.publish(member, randomUUID(), without), {
        message: "posting_limit",
      });
      assert.equal(
        (await voting.getPoll("collision"))?.question,
        "Unrelated seed",
      );
    },
  );

  check(
    "shares_one_rolling_quota_across_adapters_and_releases_the_exact_boundary",
    async ({ store, other, setTime }) => {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).publish(member, randomUUID(), body),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
      for (const r of results)
        if (r.status === "rejected") {
          assert.equal(r.reason.code, "posting_limit");
          assert.equal(r.reason.retryAfter, 3600);
        }
      setTime(new Date(AT.getTime() + HOUR_MS - 1));
      await assert.rejects(store.publish(member, randomUUID(), body), {
        message: "posting_limit",
        retryAfter: 1,
      });
      setTime(new Date(AT.getTime() + HOUR_MS));
      await store.publish(member, randomUUID(), body);
    },
  );

  check(
    "retries_once_with_canonical_input_then_replays_after_close_without_mutable_aliases",
    async ({ store, other, setTime }) => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).publish(member, key, body),
        ),
      );
      assert.equal(results.filter((r) => !r.replayed).length, 1);
      assert.equal(new Set(results.map((r) => r.poll.id)).size, 1);
      const original = structuredClone(results[0]?.poll);
      const returned = results[0];
      assert.ok(returned);
      returned.poll.question = "tampered";
      returned.poll.community.label = "tampered";
      assert.deepEqual(
        (
          await other.publish(member, key.toUpperCase(), {
            ...body,
            question: "Q",
            choices: ["A", "B"],
            attribution: { kind: "anonymous" },
          })
        ).poll,
        original,
      );
      await assert.rejects(
        store.publish(member, key, { ...body, question: "Changed" }),
        { message: "idempotency_conflict" },
      );
      assert.notEqual(
        (await store.publish(guest, key, body)).poll.id,
        original?.id,
      );
      for (let i = 0; i < 4; i++)
        await store.publish(member, randomUUID(), body);
      await assert.rejects(store.publish(member, randomUUID(), body), {
        message: "posting_limit",
      });
      setTime(new Date(AT.getTime() + WEEK_MS + 1));
      assert.deepEqual((await other.publish(member, key, body)).poll, original);
    },
  );

  check(
    "only_Owner_grants_unlimited_and_revocation_preserves_accurate_retry_time",
    async ({ store, other, make, setTime }) => {
      assert.equal((await store.context(owner)).canPostUnlimited, true);
      assert.equal(
        (await make({ ownerEmail: "absent@example.test" }).context(owner))
          .canPostUnlimited,
        false,
      );
      assert.throws(() => make({ ownerEmail: "private-invalid" }), {
        message: "PULSE_OWNER_EMAIL is not a usable address",
      });
      await assert.rejects(store.setUnlimited(member, "missing", true), {
        message: "owner_required",
      });
      await assert.rejects(store.setUnlimited(owner, "missing", true), {
        message: "not_found",
      });
      await assert.rejects(
        store.publish(owner, randomUUID(), {
          question: "Q",
          choices: ["A", "B"],
          method: "single",
        }),
        { message: "purpose_required" },
      );
      const failingAudit = make({
        newId: () => {
          throw new Error("test audit failure");
        },
      });
      await assert.rejects(
        failingAudit.setUnlimited(owner, member.voterId, true),
        /test audit failure/,
      );
      assert.equal((await other.context(member)).canPostUnlimited, false);
      await store.setUnlimited(owner, member.voterId, true);
      // A repeated desired state must not write another audit record.
      await failingAudit.setUnlimited(owner, member.voterId, true);
      assert.equal((await other.context(member)).canPostUnlimited, true);
      for (let i = 0; i < 6; i++) {
        setTime(new Date(AT.getTime() + i * 1000));
        await other.publish(member, randomUUID(), body);
      }
      await assert.rejects(store.setUnlimited(member, owner.voterId, true), {
        message: "owner_required",
      });
      await store.setUnlimited(owner, member.voterId, false);
      await failingAudit.setUnlimited(owner, member.voterId, false);
      await assert.rejects(other.publish(member, randomUUID(), body), {
        message: "posting_limit",
        retryAfter: 3596,
      });
      setTime(new Date(AT.getTime() + HOUR_MS + 1000));
      await store.publish(member, randomUUID(), body);
    },
  );

  check(
    "audit_ID_collision_and_invalid_clock_cannot_change_effective_permission",
    async ({ store, make }) => {
      const fixed = make({
        newId: () => "00000000-0000-4000-8000-000000000001",
      });
      await fixed.setUnlimited(owner, member.voterId, true);
      await assert.rejects(fixed.setUnlimited(owner, member.voterId, false));
      assert.equal((await store.context(member)).canPostUnlimited, true);
      await assert.rejects(
        make({ clock: () => new Date(NaN) }).setUnlimited(
          owner,
          member.voterId,
          false,
        ),
      );
      assert.equal((await store.context(member)).canPostUnlimited, true);
      await store.setUnlimited(owner, member.voterId, false);
      assert.equal((await store.context(member)).canPostUnlimited, false);
    },
  );

  check(
    "revocation_refuses_context_publication_replay_and_grants_and_new_sessions_work",
    async ({ store, voters }) => {
      const key = randomUUID();
      await store.publish(member, key, body);
      await voters.advanceSessionGeneration(member.voterId);
      for (const run of [
        () => store.context(member),
        () => store.publish(member, key, body),
        () => store.publish(member, randomUUID(), body),
      ])
        await assert.rejects(run, { message: "signed_out" });
      await voters.advanceSessionGeneration(owner.voterId);
      await assert.rejects(store.setUnlimited(owner, member.voterId, true), {
        message: "signed_out",
      });
      for (const generation of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
        await assert.rejects(
          store.context({ ...member, sessionGeneration: generation }),
          { message: "signed_out" },
        );
      await assert.rejects(
        store.context({ voterId: "missing", sessionGeneration: 0 }),
        { message: "signed_out" },
      );
      assert.equal(
        (await store.publish({ ...member, sessionGeneration: 1 }, key, body))
          .replayed,
        true,
      );
    },
  );
}
