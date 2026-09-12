import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import type { Voter, VoterStore } from "../../src/identity/store.js";
import type { MakeStore, SuiteOptions } from "./make.js";

/** Milliseconds on purpose: a store that drops them fails the round trips. */
const AT = new Date("2026-08-09T12:00:00.123Z");

function voter(overrides: Partial<Voter> = {}): Voter {
  return {
    id: "voter-1",
    email: "ada@student.ubc.ca",
    community: "ubc-students",
    claimedAt: AT,
    proofEmailsOptIn: false,
    ...overrides,
  };
}

/** What every `VoterStore` must do, whatever keeps its rows. */
export function voterStoreConformance(
  label: string,
  make: MakeStore<VoterStore>,
  options: SuiteOptions = {},
): void {
  const fresh = (t: TestContext) => make(() => AT, t);

  describe(
    `VoterStore conformance: ${label}`,
    { skip: options.skip ?? false },
    () => {
      test("finds_a_voter_by_address_and_by_id", async (t) => {
        // A voter who never signed out comes back with no `sessionsValidFrom`
        // key at all, not one set to undefined or to the epoch.
        const store = await fresh(t);
        const created = await store.create(voter());
        assert.deepEqual(await store.byEmail("ada@student.ubc.ca"), created);
        assert.deepEqual(await store.byId("voter-1"), created);
        assert.equal(await store.byEmail("sam@student.ubc.ca"), undefined);
        assert.equal(await store.byId("nobody"), undefined);
      });

      test("a_new_voter_has_no_sign_out_recorded", async (t) => {
        // Undefined, not epoch zero: a voter who has never signed out must not
        // have their first session compared against a real timestamp.
        const store = await fresh(t);
        const created = await store.create(voter());
        assert.equal(created.sessionsValidFrom, undefined);
      });

      test("signing_out_records_the_moment_sessions_stop_counting", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        const updated = await store.invalidateSessionsBefore("voter-1", AT);

        assert.equal(updated?.sessionsValidFrom?.getTime(), AT.getTime());
        assert.equal(
          (await store.byId("voter-1"))?.sessionsValidFrom?.getTime(),
          AT.getTime(),
        );
      });

      test("signing_out_touches_only_that_voter", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        await store.create(
          voter({ id: "voter-2", email: "sam@student.ubc.ca" }),
        );

        await store.invalidateSessionsBefore("voter-1", AT);
        assert.equal(
          (await store.byId("voter-2"))?.sessionsValidFrom,
          undefined,
        );
      });

      test("signing_out_an_unknown_voter_changes_nothing", async (t) => {
        const store = await fresh(t);
        assert.equal(
          await store.invalidateSessionsBefore("nobody", AT),
          undefined,
        );
      });

      test("one_voter_per_address", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        await assert.rejects(() => store.create(voter({ id: "voter-2" })));
      });

      test("the_opt_in_can_be_turned_on_and_off_again", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        assert.equal(
          (await store.setProofEmails("voter-1", true))?.proofEmailsOptIn,
          true,
        );
        assert.equal(
          (await store.setProofEmails("voter-1", false))?.proofEmailsOptIn,
          false,
        );
        assert.equal(await store.setProofEmails("nobody", true), undefined);
      });
    },
  );
}
