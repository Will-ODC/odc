import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryVoterStore, type Voter } from "../src/identity/store.js";

const AT = new Date("2026-08-09T12:00:00.000Z");

function voter(overrides: Partial<Voter> = {}): Voter {
  return {
    id: "voter-1",
    email: "ada@student.ubc.ca",
    community: "ubc-students",
    claimedAt: AT,
    wantsProofEmails: false,
    ...overrides,
  };
}

test("a_new_voter_has_no_sign_out_recorded", async () => {
  // Undefined, not epoch zero: a voter who has never signed out must not have
  // their first session compared against a real timestamp.
  const store = new InMemoryVoterStore();
  const created = await store.create(voter());
  assert.equal(created.sessionsValidFrom, undefined);
});

test("signing_out_records_the_moment_sessions_stop_counting", async () => {
  const store = new InMemoryVoterStore();
  await store.create(voter());
  const updated = await store.invalidateSessionsBefore("voter-1", AT);

  assert.equal(updated?.sessionsValidFrom?.getTime(), AT.getTime());
  assert.equal(
    (await store.byId("voter-1"))?.sessionsValidFrom?.getTime(),
    AT.getTime(),
  );
});

test("signing_out_touches_only_that_voter", async () => {
  const store = new InMemoryVoterStore();
  await store.create(voter());
  await store.create(voter({ id: "voter-2", email: "sam@student.ubc.ca" }));

  await store.invalidateSessionsBefore("voter-1", AT);
  assert.equal((await store.byId("voter-2"))?.sessionsValidFrom, undefined);
});

test("signing_out_an_unknown_voter_changes_nothing", async () => {
  const store = new InMemoryVoterStore();
  assert.equal(await store.invalidateSessionsBefore("nobody", AT), undefined);
});

test("one_voter_per_address", async () => {
  const store = new InMemoryVoterStore();
  await store.create(voter());
  await assert.rejects(() => store.create(voter({ id: "voter-2" })));
});

test("the_opt_in_can_be_turned_on_and_off_again", async () => {
  const store = new InMemoryVoterStore();
  await store.create(voter());
  assert.equal(
    (await store.setProofEmails("voter-1", true))?.wantsProofEmails,
    true,
  );
  assert.equal(
    (await store.setProofEmails("voter-1", false))?.wantsProofEmails,
    false,
  );
  assert.equal(await store.setProofEmails("nobody", true), undefined);
});
