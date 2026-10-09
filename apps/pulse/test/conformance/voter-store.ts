import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import {
  VoterExistsError,
  type Voter,
  type VoterStore,
} from "../../src/identity/store.js";
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
        // The two stores return the same voter shape, including legacy fields.
        const store = await fresh(t);
        const created = await store.create(voter());
        assert.deepEqual(await store.byEmail("ada@student.ubc.ca"), created);
        assert.deepEqual(await store.byId("voter-1"), created);
        assert.equal(await store.byEmail("sam@student.ubc.ca"), undefined);
        assert.equal(await store.byId("nobody"), undefined);
      });

      test("a_voter_with_no_community_reads_back_as_null_everywhere", async (t) => {
        // ADR-0030: no community is null — not undefined, not "", and not a
        // missing key — and every read and every update hands it back that
        // way, so a caller never has to know which store it is talking to.
        const store = await fresh(t);
        const created = await store.create(
          voter({ email: "jo@gmail.com", community: null }),
        );
        assert.equal(created.community, null);
        assert.deepEqual(await store.byEmail("jo@gmail.com"), created);
        assert.deepEqual(await store.byId("voter-1"), created);

        const optedIn = await store.setProofEmails("voter-1", true);
        assert.ok(optedIn && "community" in optedIn);
        assert.equal(optedIn.community, null);
        const signedOut = await store.advanceSessionGeneration("voter-1");
        assert.ok(signedOut && "community" in signedOut);
        assert.equal(signedOut.community, null);
        assert.equal((await store.byId("voter-1"))?.community, null);
      });

      test("a_new_voter_starts_in_generation_zero", async (t) => {
        const store = await fresh(t);
        const created = await store.create(voter());
        assert.equal(created.sessionGeneration ?? 0, 0);
      });

      test("signing_out_advances_the_session_generation", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        const updated = await store.advanceSessionGeneration("voter-1");

        assert.equal(updated?.sessionGeneration, 1);
        assert.equal((await store.byId("voter-1"))?.sessionGeneration, 1);
      });

      test("concurrent_sign_outs_each_advance_the_generation", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        const updates = await Promise.all(
          Array.from({ length: 8 }, () =>
            store.advanceSessionGeneration("voter-1"),
          ),
        );
        assert.deepEqual(
          updates
            .map((v) => v?.sessionGeneration)
            .sort((a, b) => (a ?? 0) - (b ?? 0)),
          [1, 2, 3, 4, 5, 6, 7, 8],
        );
        assert.equal((await store.byId("voter-1"))?.sessionGeneration, 8);
      });

      test("signing_out_touches_only_that_voter", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        await store.create(
          voter({ id: "voter-2", email: "sam@student.ubc.ca" }),
        );

        await store.advanceSessionGeneration("voter-1");
        assert.equal(
          (await store.byId("voter-2"))?.sessionGeneration,
          undefined,
        );
      });

      test("signing_out_an_unknown_voter_changes_nothing", async (t) => {
        const store = await fresh(t);
        assert.equal(await store.advanceSessionGeneration("nobody"), undefined);
      });

      test("one_voter_per_address", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        // By name: a first sign-in that loses a race recovers on exactly this.
        await assert.rejects(
          () => store.create(voter({ id: "voter-2" })),
          VoterExistsError,
        );
      });

      test("a_second_voter_under_an_existing_id_is_refused_but_not_as_an_existing_address", async (t) => {
        // VoterExistsError means "this person already has a voter", and sign-in
        // answers it by signing them in as that voter. A clash on the id alone
        // is a different fault, and must not be read as one.
        const store = await fresh(t);
        await store.create(voter());
        await assert.rejects(
          () => store.create(voter({ email: "sam@student.ubc.ca" })),
          (error: unknown) =>
            error instanceof Error && !(error instanceof VoterExistsError),
        );
        // And the attempt changed nobody.
        assert.equal(
          (await store.byId("voter-1"))?.email,
          "ada@student.ubc.ca",
        );
        assert.equal(await store.byEmail("sam@student.ubc.ca"), undefined);
      });

      test("a_repeat_of_both_id_and_address_is_an_existing_address", async (t) => {
        const store = await fresh(t);
        await store.create(voter());
        await assert.rejects(() => store.create(voter()), VoterExistsError);
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
