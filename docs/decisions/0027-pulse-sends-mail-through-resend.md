# ADR-0027: Pulse sends mail through Resend

- **Status:** accepted
- **Date:** 2026-09-13
- **Phase:** 0

## Context

`apps/pulse/src/identity/mailer.ts` has defined the `Mailer` interface since the
claim flow was written, and `ConsoleMailer` — which prints the link to a
terminal — is the only implementation anywhere in the repository. Sign-in is
the front door of pulse: a person enters their address, receives a link, and
clicks it. Without a provider behind that interface, **the only person who can
sign in is whoever is watching the process's stdout.**

`memory/pulse.md` records this as the single largest blocker to anyone but the
operator using pulse, and `docs/plans/pulse.md` P4 carries it as BLOCKED ON A
DECISION with the blocker named precisely: which provider. Everything after that
sentence is ordinary work behind an interface that already exists.

Pulse sends exactly two messages and the interface says so: the sign-in link,
and the proof of what happened after a vote. Both are transactional, both are
low volume at the sizes pulse runs at today, and the sign-in link is the one
that matters — **a link that lands in a spam folder is indistinguishable from no
link at all, and nobody reports it.** They do not get in, and pulse never hears
about it. Deliverability, not throughput or price, is the property being bought.

Four options were put to the operator on 2026-09-13:

| Option         | Read as                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| **Resend**     | Free to 3,000/month, quickest to wire, built for transactional mail        |
| **Postmark**   | ~$15/month, the strongest reputation for reaching inboxes rather than spam |
| **Amazon SES** | ~$0.10 per 1,000, cheapest at volume, fiddly setup and a sandbox to escape |
| **Plain SMTP** | Free-ish and provider-agnostic, throttled or blocked at any real volume    |

## Decision

**Pulse sends mail through Resend.** Chosen by the operator on 2026-09-13.

Four things follow from it, and they are the decision as much as the name is:

1. **No SDK.** Resend's send is one `POST https://api.resend.com/emails` with a
   bearer token and a JSON body. `ResendMailer` calls it with `fetch`, which
   Node 20 has globally. A dependency for one request would be a dependency to
   audit, update and eventually replace, and it would make the provider harder
   to change rather than easier.
2. **`fetch` is injected.** The tests drive a stub, so the whole mailer is
   exercised without a network, an account or a key. This is the same test seam
   the clock and the token generator already use in `ClaimService`.
3. **A send failure is an answer, not a fault.** `ClaimService.requestLink`
   catches `MailSendError` and returns `{ status: "send_failed" }`; the route
   answers **503**, not 500. A provider outage is not a bug in pulse and must
   not be logged as one, and the person is told plainly to try again rather than
   being shown "Check your email" for mail that is never coming.
4. **`ConsoleMailer` keeps its job.** Development stays demonstrable with no
   provider account and no key: `dev-server.ts` is unchanged and still prints
   the link to the terminal. The provider is a deployment detail, which is what
   the interface was written for.

Switching provider later replaces one file and one factory function. That is the
property the interface was built to have, and this ADR does not spend it.

## Consequences

**A sending domain is now needed, and it is the expensive half.** The code is
one file; verifying a domain and publishing SPF and DKIM records to its DNS is
the work, and it is the same work for every provider in the table above. Until
it is done, `PULSE_RESEND_API_KEY` cannot be set to anything useful.

**Two environment variables, both pulse-owned**, following the convention
`src/db/config.ts` set and the reasoning it records: `PULSE_RESEND_API_KEY` and
`PULSE_MAIL_FROM`. Nothing is read from an ambient `RESEND_API_KEY`, for the
same reason a bare `DATABASE_URL` is not read — a widely exported name aims
pulse at whatever a developer already had configured, and here that means
sending real mail from somebody else's account.

**`ResendMailer` has no caller in this PR, and that is the sequencing, not an
oversight.** `dev-server.ts` refuses to start outside development and is guarded
twice on purpose, so it is not where a production mailer is constructed. The
production entry point is its own item (`docs/plans/pulse.md`, and item 5 of the
deploy list in `memory/pulse.md`) and is what calls `resendConfig(process.env)`.
Shipping the mailer first means that item is wiring rather than design.

**A repeated send failure can still exhaust the per-address link cap.** The
claim is written before the send is attempted, so three failed sends inside the
15-minute TTL leave three live claims and a fourth request is answered "A link
is already on its way. Check your email." — which is false. Fixing it properly
needs a `ClaimStore.discard`, which is a new store method across two
implementations and the shared conformance suite, so it is recorded in
`docs/plans/pulse.md` rather than widening this change. The window is 15 minutes
and it requires the provider to be down; it is a wrong sentence, not a lockout.

**Rate limiting is unchanged.** `POST /api/sign-in` already caps at 10 an hour
per address, which is what stands between a verified sending domain and being
used to mail strangers.

### Documents reconciled

- `docs/plans/pulse.md` — P4 moves from BLOCKED ON A DECISION to built, and
  gains the `ClaimStore.discard` item this ADR defers. **Updated in this PR.**
- `apps/pulse/API.md` — `POST /api/sign-in` gains its 503. **Updated in this PR.**
- `apps/pulse/README.md` — the two new variables. **Updated in this PR.**
- `memory/pulse.md` — says `ConsoleMailer` is the only `Mailer` anywhere, in
  three places. Memory entries are updated **on master at merge time** per
  `memory/INDEX.md`, so it is deliberately **not** touched here; the merge
  checklist in `.claude/skills/odc-pipeline` owns it.
- `docs/charter.md`, `docs/implementation-plan.md` — neither mentions pulse at
  all. Nothing to reconcile.

## Charter check

**Not applicable.** `apps/pulse` and `apps/pulse-web` are charter-exempt by
operator decision, recorded in `apps/pulse/CLAUDE.md` and routed from
`memory/INDEX.md`. The two boundaries that survive the exemption both hold:
nothing here reads from or writes to `services/` or `contracts/`, and no copy
this ADR introduces says anything about how a tally is computed.
