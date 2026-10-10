import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import {
  CredentialTakenError,
  type Credential,
  type NewVoter,
  type VoterStore,
} from "../../src/identity/store.js";
import type { MakeStore, SuiteOptions } from "./make.js";

/** Milliseconds on purpose: a store that drops them fails the round trips. */
const AT = new Date("2026-08-09T12:00:00.123Z");

function voter(overrides: Partial<NewVoter> = {}): NewVoter {
  return {
    id: "voter-1",
    community: "ubc-students",
    assurance: "email",
    claimedAt: AT,
    proofEmailsOptIn: false,
    ...overrides,
  };
}

/** The credential a mailed link proves: that they hold this address. */
function email(address = "ada@student.ubc.ca"): Credential {
  return { kind: "email", value: address, verifiedAt: AT };
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
        const created = await store.create(voter(), email());
        assert.deepEqual(
          await store.byCredential("email", "ada@student.ubc.ca"),
          created,
        );
        assert.deepEqual(await store.byId("voter-1"), created);
        assert.equal(
          await store.byCredential("email", "sam@student.ubc.ca"),
          undefined,
        );
        assert.equal(await store.byId("nobody"), undefined);
      });

      test("a_voter_reads_back_its_address_from_its_credential", async (t) => {
        // P8 (ADR-0032): the address is a credential the voter holds, not a
        // column of the voter, and `/api/me` still shows it — so every read
        // and every update hands it back, along with the assurance level.
        const store = await fresh(t);
        const created = await store.create(
          voter(),
          email("ada@student.ubc.ca"),
        );
        assert.equal(created.email, "ada@student.ubc.ca");
        assert.equal(created.assurance, "email");
        for (const read of [
          await store.byId("voter-1"),
          await store.byCredential("email", "ada@student.ubc.ca"),
          await store.setProofEmails("voter-1", true),
          await store.advanceSessionGeneration("voter-1"),
        ]) {
          assert.equal(read?.email, "ada@student.ubc.ca");
          assert.equal(read?.assurance, "email");
        }
      });

      test("an_address_on_the_written_voter_is_not_what_is_stored", async (t) => {
        // Only the credential says what the address is. A caller that hands
        // over a whole Voter, stale address and all, does not get to store it.
        const store = await fresh(t);
        const stale = { ...voter(), email: "old@student.ubc.ca" };
        const created = await store.create(stale, email("ada@student.ubc.ca"));
        assert.equal(created.email, "ada@student.ubc.ca");
        assert.equal(
          (await store.byId("voter-1"))?.email,
          "ada@student.ubc.ca",
        );
        assert.equal(
          await store.byCredential("email", "old@student.ubc.ca"),
          undefined,
        );
      });

      test("a_voter_with_no_community_reads_back_as_null_everywhere", async (t) => {
        // ADR-0030: no community is null — not undefined, not "", and not a
        // missing key — and every read and every update hands it back that
        // way, so a caller never has to know which store it is talking to.
        const store = await fresh(t);
        const created = await store.create(
          voter({ community: null }),
          email("jo@gmail.com"),
        );
        assert.equal(created.community, null);
        assert.deepEqual(
          await store.byCredential("email", "jo@gmail.com"),
          created,
        );
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
        const created = await store.create(voter(), email());
        assert.equal(created.sessionGeneration ?? 0, 0);
      });

      test("signing_out_advances_the_session_generation", async (t) => {
        const store = await fresh(t);
        await store.create(voter(), email());
        const updated = await store.advanceSessionGeneration("voter-1");

        assert.equal(updated?.sessionGeneration, 1);
        assert.equal((await store.byId("voter-1"))?.sessionGeneration, 1);
      });

      test("concurrent_sign_outs_each_advance_the_generation", async (t) => {
        const store = await fresh(t);
        await store.create(voter(), email());
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
        await store.create(voter(), email());
        await store.create(
          voter({ id: "voter-2" }),
          email("sam@student.ubc.ca"),
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
        await store.create(voter(), email());
        // By name: a first sign-in that loses a race recovers on exactly this.
        await assert.rejects(
          () => store.create(voter({ id: "voter-2" }), email()),
          CredentialTakenError,
        );
      });

      test("a_taken_credential_error_does_not_expose_the_address", async (t) => {
        const store = await fresh(t);
        const address = "private-address@example.test";
        await store.create(voter(), email(address));
        await assert.rejects(
          () => store.create(voter({ id: "voter-2" }), email(address)),
          (error: unknown) => {
            assert.ok(error instanceof CredentialTakenError);
            assert.ok(!String(error).includes(address));
            assert.ok(!error.stack?.includes(address));
            return true;
          },
        );
      });

      test("a_refused_credential_leaves_no_voter_behind", async (t) => {
        // Both or neither (ADR-0032). The voter row is written first, so a
        // store that does not write the pair as one leaves voter-2 standing
        // with no credential — a voter nothing can sign in as.
        const store = await fresh(t);
        await store.create(voter(), email());
        await assert.rejects(
          () => store.create(voter({ id: "voter-2" }), email()),
          CredentialTakenError,
        );
        assert.equal(await store.byId("voter-2"), undefined);
        assert.equal(
          (await store.byCredential("email", "ada@student.ubc.ca"))?.id,
          "voter-1",
        );
      });

      test("the_same_value_under_another_kind_is_another_credential", async (t) => {
        // The key is the pair. Only `email` exists today, so this is read
        // through the lookup alone: asking for the address under a kind that
        // is not `email` finds nobody.
        const store = await fresh(t);
        await store.create(voter(), email());
        assert.equal(
          await store.byCredential(
            "in_person" as "email",
            "ada@student.ubc.ca",
          ),
          undefined,
        );
      });

      test("a_second_voter_under_an_existing_id_is_refused_but_not_as_a_taken_credential", async (t) => {
        // CredentialTakenError means "this person already has a voter", and
        // sign-in answers it by signing them in as that voter. A clash on the
        // id alone is a different fault, and must not be read as one.
        const store = await fresh(t);
        await store.create(voter(), email());
        await assert.rejects(
          () => store.create(voter(), email("sam@student.ubc.ca")),
          (error: unknown) =>
            error instanceof Error && !(error instanceof CredentialTakenError),
        );
        // And the attempt changed nobody.
        assert.equal(
          (await store.byId("voter-1"))?.email,
          "ada@student.ubc.ca",
        );
        assert.equal(
          await store.byCredential("email", "sam@student.ubc.ca"),
          undefined,
        );
      });

      test("a_repeat_of_both_id_and_address_is_a_taken_credential", async (t) => {
        const store = await fresh(t);
        await store.create(voter(), email());
        await assert.rejects(
          () => store.create(voter(), email()),
          CredentialTakenError,
        );
      });

      test("the_opt_in_can_be_turned_on_and_off_again", async (t) => {
        const store = await fresh(t);
        await store.create(voter(), email());
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
