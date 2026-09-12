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
    email: "ada@student.ubc.ca",
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

      test("marking_a_claim_used_records_when", async (t) => {
        const store = await fresh(t);
        await store.put(claim());
        const usedAt = new Date(AT.getTime() + 60_000);
        await store.markUsed("hash-1", usedAt);
        assert.equal(
          (await store.byTokenHash("hash-1"))?.usedAt?.getTime(),
          usedAt.getTime(),
        );
      });

      test("marking_an_unknown_claim_used_changes_nothing", async (t) => {
        const store = await fresh(t);
        await store.markUsed("hash-1", AT);
        assert.equal(await store.byTokenHash("hash-1"), undefined);
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
          claim({ tokenHash: "other-address", email: "sam@student.ubc.ca" }),
        );

        const live = await store.liveFor("ada@student.ubc.ca", AT);
        assert.deepEqual(
          live.map((c) => c.tokenHash),
          ["live"],
        );
      });
    },
  );
}
