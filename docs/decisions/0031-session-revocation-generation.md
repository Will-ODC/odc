# ADR-0031: Pulse revokes sessions with a stored generation

- **Status:** accepted (operator, 2026-10-10)
- **Date:** 2026-10-09
- **Phase:** 0

## Context

Pulse promises that signing out stops a copied session on every device. A
timestamp cutoff cannot keep that promise when two API instances have different
clocks: a session issued earlier by a clock that is 20 milliseconds ahead can
appear newer than a later sign-out on another instance. The same-millisecond
cutoff fix does not solve that ordering problem.

## Decision

Each voter has a nonnegative session generation in Pulse's own database. A
session cookie is signed with the generation read when its link is redeemed.
Every authenticated request compares that value with the current voter row.
Sign-out atomically increments the row's generation, independent of application
clock time. Expiry remains timestamp based; clocks affect when a cookie expires,
but cannot restore a generation invalidated by sign-out.

The generation is shared by all API instances through the voter store. A
redeem racing with sign-out may sign an older snapshot; its cookie is refused
on the next request. That is preferable to reviving a revoked session.

Cookies issued under the old session format contain no generation and are
refused after rollout, requiring a new sign-in. The ballot cookie keeps its
existing format and remains valid, preserving access to a browser's vote.
Deployments must drain old API instances before accepting requests on the new
version: mixed instances cannot share one revocation rule.

## Consequences

Sign-out performs one atomic update of the voter row and every authenticated
request reads its current generation. The existing `sessions_valid_from`
column remains in the forward-only schema but is no longer used for session
authorization. A new migration adds `session_generation` initialized to zero.

### Documents reconciled

`apps/pulse/API.md` is updated in this change. `apps/pulse/README.md`,
`memory/pulse.md`, and `docs/plans/pulse.md` do not specify a timestamp
revocation mechanism and need no correction.

## Charter check

Pulse is expressly exempt from `docs/charter.md`. This decision affects only
Pulse's own identity and session storage and crosses no service boundary.
