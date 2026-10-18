import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { InMemoryVoterStore } from "../src/identity/store.js";
import type { NewPoll } from "../src/voting/poll.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { AT, body, member } from "./conformance/creation-store.js";

async function identity() {
  const voters = new InMemoryVoterStore();
  await voters.create(
    {
      id: member.voterId,
      community: null,
      assurance: "email",
      claimedAt: AT,
      proofEmailsOptIn: false,
    },
    { kind: "email", value: "member@example.test", verifiedAt: AT },
  );
  return voters;
}

test("sign_out_waits_for_a_publication_already_in_progress_then_refuses_old_session_replay", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  class HeldVoting extends InMemoryVotingStore {
    override async createPoll(input: NewPoll) {
      entered();
      await held;
      return super.createPoll(input);
    }
  }
  const voters = await identity();
  const voting = new HeldVoting(() => AT);
  const store = new InMemoryCreationStore(voters, voting, { clock: () => AT });
  const key = randomUUID();
  const publication = store.publish(member, key, body);
  await started;
  let signedOut = false;
  const signOut = voters.advanceSessionGeneration(member.voterId).then(() => {
    signedOut = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signedOut, false);
    assert.equal(
      (await voters.byId(member.voterId))?.sessionGeneration ?? 0,
      0,
    );
  } finally {
    release();
  }
  const result = await publication;
  await signOut;
  assert.ok(await voting.getPoll(result.poll.id));
  await assert.rejects(store.publish(member, key, body), {
    message: "signed_out",
  });
  assert.equal(
    (await store.publish({ ...member, sessionGeneration: 1 }, key, body))
      .replayed,
    true,
  );
});

test("a_sign_out_queued_first_refuses_publication_without_acknowledging_the_promise", async () => {
  const voters = await identity();
  const store = new InMemoryCreationStore(
    voters,
    new InMemoryVotingStore(() => AT),
    { clock: () => AT },
  );
  const signOut = voters.advanceSessionGeneration(member.voterId);
  await assert.rejects(store.publish(member, randomUUID(), body), {
    message: "signed_out",
  });
  await signOut;
  assert.equal(
    (await store.context({ ...member, sessionGeneration: 1 }))
      .purposeAcknowledged,
    false,
  );
});

test("an_unconfigured_owner_cannot_grant_and_a_new_memory_database_has_no_old_state", async () => {
  const voters = await identity();
  const voting = new InMemoryVotingStore(() => AT);
  const store = new InMemoryCreationStore(voters, voting, { clock: () => AT });
  assert.equal((await store.context(member)).canPostUnlimited, false);
  await assert.rejects(store.setUnlimited(member, member.voterId, true), {
    message: "owner_required",
  });
  await store.publish(member, randomUUID(), body);
  const restarted = new InMemoryCreationStore(
    voters,
    new InMemoryVotingStore(() => AT),
    { clock: () => AT },
  );
  assert.equal((await restarted.context(member)).purposeAcknowledged, false);
  assert.throws(
    () => new InMemoryCreationStore(new InMemoryVoterStore(), voting),
    /same database/,
  );
});
