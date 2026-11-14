# Pulse verbosity and unnecessary complexity audit — 2026-11-14

Audited `0bf9c616e7002e0eb07820c4e8883d0df825cc77` in a fresh, read-only Codex
context. Scope: Pulse API/client code, their guides and API reference, and
representative routing, posting, browsing, redemption and contribution tests.
Core services and verifiers were excluded. This was a targeted maintainability
review, not an exhaustive dead-code or correctness audit.

## Findings

**[SHOULD, low] Stale status prose in the server README (#616).**
`apps/pulse/README.md:22–32` says poll publishing has no screen and groups the
browser list with unbuilt MCP discovery. The `/new` route and `NewPoll` screen
are implemented (`apps/pulse-web/src/flow/route.ts:144`, `App.tsx:234`), as are
Home and `/browse` (`route.ts:152`, `App.tsx:135`). The NewPoll and Browse suites
exercise these screens. MCP discovery alone remains planned (#291).

The README already links current status to `memory/pulse.md`; duplicating
milestone history created another status source that drifted. The accompanying
#616 correction names the working screens, links quotas and permissions to
`API.md`, and preserves the owner configuration. Verification is a docs-only
diff, route/API/link inspection and formatting; no new runtime tests are needed.

**[NIT, low] Obsolete routing history comments.**
`apps/pulse-web/src/flow/route.ts:7–13` describes three routes plus a prototype;
the route union now has fifteen kinds. Lines 63–65 describe authored/browsed
questions as future work, despite the implemented paths above. On a future
edit, replace the old count/history with the current parsing and fallback
contract. Preserve token case and path-normalization rationale. This optional
cleanup is deferred; it does not warrant a separate runtime refactor or a
repository-wide comment sweep.

## Complexity with a current purpose

No additional runtime refactor is justified by this audit:

- The promise retained across StrictMode replay in `hooks/use-redeem.ts:37–61`
  keeps a live redemption subscriber; `test/Redeem.test.tsx:78–97` exercises it.
- Contribution draft ownership, request generations, account preconditions and
  retry keys cover different stale-read, account-switch and uncertain-write
  boundaries. The contribution tests exercise these cases. Reducing their
  line count alone would change behavior.
- Transaction commit/rollback checks and the allow-listed fault projection
  protect atomicity and privacy. A universal resource/form abstraction has no
  demonstrated benefit over the current separate policies.

Reuse existing owners: #533 retry rendering; #534 shared controls; #536/#537
Conversation/VoteCard extraction; #538 CSS/tokens; #539 session-provider
decision; #591, #599 and #610 existing follow-ups. The test-audit listener gaps
remain #613/#614. No duplicate tickets were opened for these areas.

Overlap checks used the supplied open-issue title inventory and relevant
memory; they did not exhaustively inspect every issue body. The audit itself
ran no tests and changed no source. The report and README correction receive
independent review and the repository's required CI before merge.
