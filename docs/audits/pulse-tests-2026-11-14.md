# Pulse test audit — 2026-11-14

Audited detached `0bf9c61` in `/workspace/odc-test-audit`, following `memory/pulse.md`, Current operator direction item 3, and the repository testing/review skills. Report only; temporary source mutations and harnesses are restored/removed before completion. No core ledger/verifier source was read.

## Concrete findings

### [SHOULD] P2 — #613: A sign-in return can land before the session subscription exists

`apps/pulse-web/src/hooks/use-session.ts:177` (listeners at 199–201).

In default mode (`recheckSignedIn` is false), the initial session read can commit `signedOut` or `unknown` and show sign-in/confirmation controls before the passive effect attaches focus, storage and visibility listeners. A return/announcement in that interval is discarded. Attaching the listeners afterward does not recheck or reconcile the event, leaving stale signed-out state until another event or reload. This is the same class of gap already addressed for `useOwnerProfile`, whose subscription uses a layout effect; that fix does not cover this shared session hook.

A deterministic scheduling harness below emits focus in the layout phase of the commit that first exposes `signedOut`. The next `me()` would return account A, but the event is lost and the hook remains `signedOut`. This proves the missing subscription at that boundary; it does not measure the probability of a human hitting it in a production browser. Ordinary tests await settled React effects and do not cover this boundary. Fix the subscription boundary (and add an immediate-return regression) without weakening the request-generation guards. This is separate from #539's proposed session-provider refactor.

### [SHOULD] P3 — #614: Back during startup can leave the address and rendered route inconsistent

`apps/pulse-web/src/hooks/use-route.ts:34`.

The hook initializes its URL during render but attaches `popstate` only in a passive effect. A history transition between initial commit and that subscription is lost, and the effect never reads the current URL to catch up. The harness initializes `/about`, changes the URL to `/trust` and emits `popstate` in layout; the output remains `about` after subscription. This models an event at the vulnerable boundary, rather than claiming a measured real-world Back failure rate. Install the subscription before that boundary and/or reconcile the current location when subscribing; retain a regression test. `test/route.test.ts` exercises route parsing, not this subscription.

## Repeat testing

All six pre-existing suspect suites passed every run: **0/30 failed runs per file (0% observed failure rate)**, 6,630 test executions overall. This supplies no evidence of a natural flake in these selected files on this machine; it does not prove they cover the two controlled event gaps.

| Existing test file         | Tests per run | Runs | Failed runs |
| -------------------------- | ------------- | ---- | ----------- |
| `Contributions.test.tsx`   | 59            | 30   | 0 / 30 (0%) |
| `Conversation.test.tsx`    | 75            | 30   | 0 / 30 (0%) |
| `NewPoll.test.tsx`         | 34            | 30   | 0 / 30 (0%) |
| `SignIn.test.tsx`          | 35            | 30   | 0 / 30 (0%) |
| `session-changes.test.tsx` | 10            | 30   | 0 / 30 (0%) |
| `use-paged-list.test.tsx`  | 8             | 30   | 0 / 30 (0%) |

Six evidence-selected existing suites cover passive session listeners, creation-form focus/draft effects, counted-vote effects, contribution load/focus effects and paged-list generation resets. No blanket 30× full-suite run was performed.

Commands used from the audited worktree:

```sh
source /workspace/.local/bin/odc-env
# Node v20.20.2; pnpm 9.0.0; Vitest v4.1.12 as installed offline.
# PULSE_REQUIRE_DATABASE=1
# PULSE_DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5432/pulse_test
for run in $(seq 1 30); do
  pnpm --filter @odc/pulse-web exec vitest run \
    test/session-changes.test.tsx test/SignIn.test.tsx \
    test/use-paged-list.test.tsx test/Contributions.test.tsx \
    test/NewPoll.test.tsx test/Conversation.test.tsx \
    --reporter=json --outputFile=/tmp/pulse-audit-repeats/run-$run.json \
    > /tmp/pulse-audit-repeats/run-$run.log 2>&1
  echo "$run:$?" >> /tmp/pulse-audit-repeats/status
done
```

The deterministic two-test harness failed both assertions in **30/30 runs (100%)**; each test therefore failed 30/30 times. It was run separately, with the same command replacing the six paths with `test/audit-passive-gap.test.tsx` and `run-` with `gap-`. Raw JSON/logs remain in `/tmp/pulse-audit-repeats/` during this workspace session. As a causal control, temporary copies of the two hooks with only their subscription effect changed from `useEffect` to `useLayoutEffect` passed both assertions (2/2, one run; `/tmp/pulse-audit-layout-control.log`). Original hooks were untouched during that control and all temporary hook/test files were removed.

Supplementary orchestrator-owned baselines (separate from auditor-owned repeats): elevated full client suite passed all 71 files / 967 tests (210.58s); PostgreSQL-required full API suite passed 919 tests / 10 suites, 0 skips (256.19s). Logs: `/tmp/odc-web-baseline-network.log`, `/tmp/odc-api-baseline.log`. The earlier restricted client run failed only the dev-proxy bind test; the elevated rerun resolved that sandbox restriction. Concurrent baselines and early repeats shared a two-core machine; later repeats ran after those baselines finished.

## Guard mutation checks

All six injected guard defects were killed by relevant existing tests. Each mutation is made alone in the source, compiled to its own existing `dist/src/*.js` with TypeScript 5.9.3 `transpileModule` (`module: ES2022`, `target: ES2022`), tested, then both source bytes and compiled bytes restored in `finally`. This avoids rebuilding unrelated code and preserves baseline sources for the repeat suites. Baseline sources first passed `pnpm --filter @odc/pulse build`.

Database tests run in the elevated execution environment because the default sandbox forbids local sockets; they use existing disposable Postgres 17 test containers and throwaway schemas. All mutation test counts include a zero-skips check. The API test command for each row is `node --test apps/pulse/dist/test/<suite>.test.js` after sourcing the environment above. The runner is preserved at `/tmp/pulse-audit-mutations.cjs`; commands and exact substitutions are included below for reproduction.

Baseline: `image-visibility.test.js`, `profile-stores.test.js`, `migrate.test.js` together passed 30/30 tests with 0 skips; `contributions-http.test.js` separately passed 33/33 with 0 skips. Logs are `/tmp/pulse-audit-mutation-baseline.log` and `/tmp/pulse-audit-contribution-baseline.log`.

All mutation runs exited 1; all used 0 skipped tests:

| Source guard                                 | Exact substitution                                                                                         | Test suite           | Failed / total | Failing behavior                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- | -------------- | -------------------------------------------------------------------------------- |
| `apps/pulse/src/images/visibility.ts:41`     | `return owner.visible && owner.currentImageId === image.id;` → `return owner.currentImageId === image.id;` | `image-visibility`   | 1 / 5          | Hidden poll picture must be refused                                              |
| `apps/pulse/src/profiles/memory-store.ts:43` | `if (!found?.[1].visible) return undefined;` → `if (!found) return undefined;`                             | `profile-stores`     | 1 / 8          | Memory opt-in public profile/hidden lookup                                       |
| `apps/pulse/src/profiles/pg-store.ts:44`     | SQL `where public_id = $1 and visible = true` → `where public_id = $1`                                     | `profile-stores`     | 1 / 8          | Postgres opt-in public profile/hidden lookup                                     |
| `apps/pulse/src/http/contributions.ts:135`   | `if (accountId !== (request as Authenticated)[actor]?.id)` → `if (false)`                                  | `contributions-http` | 4 / 33         | Each of create/participate/update/message refuses another account without writes |
| `apps/pulse/src/db/migrate.ts:123`           | `if (applied !== migration.checksum) {` → `if (false) {`                                                   | `migrate`            | 1 / 17         | `refuses_a_migration_that_changed_after_it_ran`                                  |
| `apps/pulse/src/db/migrate.ts:118`           | `refuseOutOfOrder(migrations, rows);` → `// audit: guard removed`                                          | `migrate`            | 1 / 17         | `refuses_a_migration_that_numbers_below_one_already_applied`                     |

These are successful sensitivity spot-checks, not evidence of an existing guard defect or exhaustive mutation coverage. No tested mutation survived. Restore before switching cases; do not combine these mutations.

## Required workflow checks

Compared all checked-in workflow job names with live `protect-master` ruleset 19180354, fetched by the orchestrator to `/workspace/odc-protect-master.json`.

Required checks (strict): `format / lint / typecheck`, `diff-size`, `guard-tests`, `guard`, `memory-index`. Every general repo workflow job is required. Despite its name, `.github/workflows/repo.yml`'s `format / lint / typecheck` job also runs boundary tests, all package tests including Pulse integration, and other repository checks; these are not missing gates.

`pulse-images` is the only additional current workflow job and is not required. Existing **#612** owns making this safe (it currently has path filters) and the processing smoke-test gap. Do not create a duplicate. The live ruleset requires zero approving reviews; this is a configuration observation, not proof that fresh-context agent review was bypassed, and a GitHub approval alone would not verify reviewer independence.

## Other inspected patterns and limits

- `usePagedList:42` resets loading/generations in a passive effect when the fetch key changes. `usePoll`, `useMemberProfile`, `useContributionRead` and Browse contribution paging also use passive load/reset cleanup. These warrant care for synchronous key/prop replacement, but the routed poll/community/contribution pages largely remount with keys, and contribution/account forms use render-time ownership plus layout guards. No additional user-reachable draft corruption was established here; these are hypotheses, not issues to file from this audit.
- Conversation's counted-ballot-to-picked effect (`Conversation.tsx:751`) and the focus effects in NewPoll, SignIn, VoteCard and contribution forms were included in source review and selected repeated tests. A successful repeat result cannot prove absence of the event boundary gaps shown above.
- Existing #591 covers `useLaterVotes` render-ref and dock-space cleanup/reload follow-ups. #610 covers contribution per-form account-changed notices and stale same-account notices; #599 covers contribution form UI nits. They are excluded from new findings. The prior #592 profile regressions are context, not newly rediscovered defects.
- Synthetic gap failure counts are separate from pre-existing suite flake counts. No user-facing production frequency or security bypass is inferred from the scheduling harness.

## Reproduction harness

Place the following temporarily at `apps/pulse-web/test/audit-passive-gap.test.tsx`, run the command described above, and remove it afterward:

```tsx
// @vitest-environment jsdom
import { useLayoutEffect, useRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSession } from "../src/hooks/use-session.js";
import { useRoute } from "../src/hooks/use-route.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);

it("does not miss a sign-in return at the commit showing signed-out controls", async () => {
  const me = vi.fn(async () =>
    me.mock.calls.length === 1
      ? null
      : { id: "a", email: "a@example.test", community: null },
  );
  const api = stubApi({ me });
  function Probe() {
    const { session } = useSession(api);
    const sent = useRef(false);
    useLayoutEffect(() => {
      if (session.status === "signedOut" && !sent.current) {
        sent.current = true;
        window.dispatchEvent(new Event("focus"));
      }
    }, [session]);
    return <output>{session.status}</output>;
  }
  render(<Probe />);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("signedIn"),
  );
});

it("does not miss Back between initial route commit and passive subscription", () => {
  history.replaceState(null, "", "/about");
  function Probe() {
    const { route } = useRoute();
    useLayoutEffect(() => {
      history.replaceState(null, "", "/trust");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, []);
    return <output>{route.kind}</output>;
  }
  render(<Probe />);
  expect(screen.getByRole("status").textContent).toBe("trust");
});
```

## Cleanup

All six source and compiled mutation targets were restored byte-for-byte by the mutation runner. The gap harness and layout-control copies were removed. `git diff --exit-code` and `git status --short` were clean after cleanup; the report and raw evidence live outside the worktree.
