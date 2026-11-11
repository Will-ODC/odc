import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import type { ClaimStore, PendingClaim } from "../../src/identity/store.js";
import type { MakeStore, SuiteOptions } from "./make.js";

/** Milliseconds on purpose: a store that drops them fails the round trips. */
const AT = new Date("2026-08-09T12:00:00.123Z");
const LATER = new Date(AT.getTime() + 15 * 60_000);

function claim(overrides: Partial<PendingClaim> = {}): PendingClaim {
  return {
    tokenHash: "hash-1",
    kind: "email",
    subject: "ada@student.ubc.ca",
    community: "ubc-students",
    proofEmailsOptIn: false,
    createdAt: AT,
    expiresAt: LATER,
    ...overrides,
  };
}

/**
 * What every `ClaimStore` must do, whatever keeps its rows.
 *
 * `ClaimService` is tested through the in-memory store in `claim.test.ts`.
 * These pin the store's own contract — the one that service relies on — which
 * had no tests of its own before a second implementation needed them.
 */
export function claimStoreConformance(
  label: string,
  make: MakeStore<ClaimStore>,
  options: SuiteOptions = {},
): void {
  const fresh = (t: TestContext) => make(() => AT, t);

  describe(
    `ClaimStore conformance: ${label}`,
    { skip: options.skip ?? false },
    () => {
      test("returns_a_claim_by_its_token_hash", async (t) => {
        // An unused claim comes back with no `usedAt` key at all.
        const store = await fresh(t);
        const stored = claim({ proofEmailsOptIn: true });
        await store.put(stored);
        assert.deepEqual(await store.byTokenHash("hash-1"), stored);
        assert.equal(await store.byTokenHash("hash-2"), undefined);
      });

      test("a_discarded_claim_neither_reads_back_nor_counts", async (t) => {
        // P4a: a link whose email the provider refused never left pulse, so
        // it must stop counting against the address's live-link cap.
        const store = await fresh(t);
        await store.put(claim());
        await store.put(claim({ tokenHash: "hash-2" }));
        await store.discard("hash-1");
        assert.equal(await store.byTokenHash("hash-1"), undefined);
        const live = await store.liveFor("email", "ada@student.ubc.ca", AT);
        assert.deepEqual(
          live.map((c) => c.tokenHash),
          ["hash-2"],
        );
      });

      test("discarding_a_claim_that_is_not_there_changes_nothing", async (t) => {
        const store = await fresh(t);
        await store.put(claim());
        await store.discard("hash-404");
        assert.deepEqual(await store.byTokenHash("hash-1"), claim());
      });

      test("discard_keeps_the_hash_only_record_that_a_link_was_used", async (t) => {
        const store = await fresh(t);
        await store.put(claim());
        assert.equal(await store.markUsed("hash-1", AT), true);
        await store.discard("hash-1");
        assert.equal(await store.byTokenHash("hash-1"), undefined);
        assert.equal(await store.wasUsed("hash-1"), true);
      });

      test("a_claim_with_no_community_reads_back_as_null_everywhere", async (t) => {
        // ADR-0030: an address no community claims still gets a link, and
        // its claim carries community null to the redeem that copies it onto
        // the voter. Null, not undefined or "", through every read.
        const store = await fresh(t);
        const stored = claim({ subject: "jo@gmail.com", community: null });
        await store.put(stored);
        assert.deepEqual(await store.byTokenHash("hash-1"), stored);

        const live = await store.liveFor("email", "jo@gmail.com", AT);
        assert.deepEqual(live, [stored]);

        await store.markUsed("hash-1", AT);
        assert.equal(await store.byTokenHash("hash-1"), undefined);
        assert.equal(await store.wasUsed("hash-1"), true);
      });

      test("spending_a_link_deletes_its_pending_data_and_keeps_only_its_hash", async (t) => {
        const store = await fresh(t);
        await store.put(claim());
        assert.equal(await store.wasUsed("hash-1"), false);
        assert.equal(await store.markUsed("hash-1", AT), true);
        assert.equal(await store.byTokenHash("hash-1"), undefined);
        assert.equal(await store.wasUsed("hash-1"), true);
        assert.equal(await store.wasUsed("unknown"), false);
      });

      test("the_next_write_sweeps_expired_claims_for_all_subjects_at_the_boundary", async (t) => {
        const store = await fresh(t);
        await store.put(claim({ tokenHash: "expired" }));
        await store.put(
          claim({
            tokenHash: "still-live",
            expiresAt: new Date(LATER.getTime() + 1),
          }),
        );
        await store.put(
          claim({
            tokenHash: "new",
            subject: "other@example.test",
            createdAt: LATER,
            expiresAt: new Date(LATER.getTime() + 15 * 60_000),
          }),
        );
        assert.equal(await store.byTokenHash("expired"), undefined);
        assert.equal(await store.wasUsed("expired"), false);
        assert.ok(await store.byTokenHash("still-live"));
        assert.ok(await store.byTokenHash("new"));
      });

      test("purge_removes_expired_pending_and_old_used_rows_but_keeps_live_rows", async (t) => {
        const store = await fresh(t);
        await store.put(claim({ tokenHash: "expired" }));
        await store.put(
          claim({
            tokenHash: "live",
            expiresAt: new Date(LATER.getTime() + 1),
          }),
        );
        await store.put(claim({ tokenHash: "old-used" }));
        await store.put(claim({ tokenHash: "recent-used" }));
        assert.equal(await store.markUsed("old-used", AT), true);
        assert.equal(
          await store.markUsed("recent-used", new Date(AT.getTime() + 1)),
          true,
        );

        await store.purgeExpired(LATER, AT);

        assert.equal(await store.byTokenHash("expired"), undefined);
        assert.ok(await store.byTokenHash("live"));
        assert.equal(await store.wasUsed("old-used"), false);
        assert.equal(await store.wasUsed("recent-used"), true);
      });

      test("an_expired_claim_cannot_be_spent_even_before_the_next_sweep", async (t) => {
        const store = await fresh(t);
        await store.put(claim());
        assert.equal(await store.markUsed("hash-1", LATER), false);
        assert.equal(await store.wasUsed("hash-1"), false);
      });

      test("marking_an_unknown_claim_used_changes_nothing", async (t) => {
        const store = await fresh(t);
        assert.equal(await store.markUsed("hash-1", AT), false);
        assert.equal(await store.byTokenHash("hash-1"), undefined);
      });

      test("a_link_can_be_spent_only_once", async (t) => {
        // The second spend answers false; no pending personal data remains.
        // ClaimService relies on this answer, not on a read taken before it —
        // that read is what two simultaneous clicks both get wrong.
        const store = await fresh(t);
        await store.put(claim());
        const first = new Date(AT.getTime() + 60_000);
        assert.equal(await store.markUsed("hash-1", first), true);
        assert.equal(
          await store.markUsed("hash-1", new Date(first.getTime() + 60_000)),
          false,
        );
        assert.equal(await store.byTokenHash("hash-1"), undefined);
        assert.equal(await store.wasUsed("hash-1"), true);
      });

      test("live_links_are_the_unused_unexpired_ones_for_that_address", async (t) => {
        const store = await fresh(t);
        await store.put(claim({ tokenHash: "live" }));
        await store.put(claim({ tokenHash: "used" }));
        await store.markUsed("used", AT);
        // Expiring exactly now counts as expired: `ClaimService` refuses a link
        // whose `expiresAt <= now`, so calling it live would disagree with it.
        await store.put(claim({ tokenHash: "expired-now", expiresAt: AT }));
        await store.put(
          claim({ tokenHash: "other-address", subject: "sam@student.ubc.ca" }),
        );

        const live = await store.liveFor("email", "ada@student.ubc.ca", AT);
        assert.deepEqual(
          live.map((c) => c.tokenHash),
          ["live"],
        );
      });

      test("a_claim_reads_back_its_kind_and_subject", async (t) => {
        // P8 (ADR-0033): a link proves a credential of some kind, and the
        // address it was sent to is that credential's subject.
        const store = await fresh(t);
        await store.put(claim());
        const stored = await store.byTokenHash("hash-1");
        assert.equal(stored?.kind, "email");
        assert.equal(stored?.subject, "ada@student.ubc.ca");
      });

      test("live_links_are_counted_per_kind_as_well_as_per_subject", async (t) => {
        // The throttle is on the pair. Only `email` exists today, so the other
        // half is read through the lookup: the same subject under a kind that
        // is not `email` has no live links.
        const store = await fresh(t);
        await store.put(claim({ tokenHash: "one" }));
        await store.put(claim({ tokenHash: "two" }));
        assert.deepEqual(
          (await store.liveFor("email", "ada@student.ubc.ca", AT))
            .map((c) => c.tokenHash)
            .sort(),
          ["one", "two"],
        );
        assert.deepEqual(
          await store.liveFor("in_person" as "email", "ada@student.ubc.ca", AT),
          [],
        );
      });
    },
  );
}
