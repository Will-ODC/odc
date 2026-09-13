# ADR-0028: Pulse is served as two images on one origin

- **Status:** accepted
- **Date:** 2026-09-13
- **Phase:** 0

## Context

`apps/pulse/src/dev-server.ts` is the only entry point pulse has ever had, and
it refuses to start outside development — guarded twice, on purpose. It invents
a session secret, falls back to keeping everything in memory, prints sign-in
links to a terminal, and sends its session cookie without `Secure`. Every one of
those is right for a laptop and none of them is right anywhere else.

`memory/pulse.md` has carried this as item 5 of its deploy list since
2026-08-25, with the constraint stated plainly: **a sibling `main`, never an
edit to `dev-server.ts`.** Anything that "makes dev-server production-capable"
is undoing a deliberate safety property. There was also no Dockerfile anywhere
in the repository, on any branch, in the entire history — so `just up` started
nothing and exited 0, while `docs/implementation-plan.md` and ADR-0001 both
described the dev entry point as settled.

Two questions had to be answered before any of it could be written, and the
operator answered both on 2026-09-13.

**How many processes?** The operator's stated preference is two — a separate
frontend and backend, which is how they have worked before.

**How many origins?** This is the question that actually has consequences, and
it is easy to mistake for the first one. Pulse's session and ballot cookies are
`SameSite=Lax` (`apps/pulse/src/http/server.ts`), which means a browser attaches
them only to the site that issued them. Serve the page from `pulse.example.org`
and the API from `api.pulse.example.org` and the browser treats the API as a
third party: it sends no cookie, and sign-in silently stops working. The
available fix is `SameSite=None`, which switches off the cross-site protection
that currently stops another site making requests as a signed-in person, and
then rebuilding that protection by hand with an origin check or CSRF tokens on
every state-changing route.

`memory/pulse.md` item 7 had already reached the same place from the other
direction: "splitting the origins means revisiting cookie code that was written
assuming it never had to be."

## Decision

**Two images, two processes, one origin.**

- `apps/pulse/Dockerfile` builds the API and runs `dist/src/main.js`.
- `apps/pulse-web/Dockerfile` builds the client with vite and serves it from
  nginx, **forwarding `/api` to the API container**. It is the front door.
- `apps/pulse/docker-compose.yml` gains both behind a `serve` profile, so
  `up db` — what the tests and CI want — still starts a database and not two
  image builds.

The two channels stay exactly as separate as they always were. The page server
sends the same bytes to everyone: HTML, JavaScript, CSS, and no personal data.
The API sends bytes that are about you: who you are, your vote, the counts.
One origin does not merge them; it means the browser sees one website, which is
the condition the cookie code was written under. It is also the shape
development already has — `apps/pulse-web/vite.config.ts` proxies `/api` to
port 8080 for exactly this reason, and has since the first UI branch.

**`src/main.ts` refuses where `dev-server.ts` defaults.** Four values have no
default and the process does not start without them: `PULSE_SESSION_SECRET`,
`PULSE_DATABASE_URL`, `PULSE_RESEND_API_KEY` and `PULSE_WEB_ORIGIN`. Each one is
something `dev-server.ts` is allowed to invent, and each invention is a silent
failure when served: a secret nobody chose that signs everyone out on restart,
votes kept in memory and lost on deploy, sign-in links printed into a log file,
and an emailed link pointing at localhost. Everything missing is named in one
message, so configuring a deployment is not a sequence of failed boots each
revealing one more thing.

## Consequences

**The API container publishes no port.** Only the client's 8080 is published;
the API is reachable over the compose network and by nothing else. In another
runtime the one line to change is `proxy_pass` in
`apps/pulse-web/nginx.conf`.

**Migrations run on boot**, in `buildServer`. #150's runner takes an advisory
lock and skips what has already run, which is the case it was built for, so
several instances starting at once is fine.

**SIGTERM is handled.** Docker and Kubernetes send it and wait; without a
handler node exits immediately, cutting off requests in flight and dropping
pooled connections rather than returning them — which the database sees as a
client crash on every deploy.

**`ServeConfig.schema` is new**, reading `PULSE_DATABASE_SCHEMA`.
`src/db/pool.ts` already named this as the knob for deploying pulse beside
something else in one database, which is the ordinary shape of a managed
Postgres. It is also what lets the database-backed test of the real production
wiring run in a throwaway schema.

**A served pulse sends real email.** There is no `ConsoleMailer` in this path by
construction, so `just pulse-up` with a live key mails whoever signs in. `pnpm
dev` remains the way to click through the flow.

**Two things a deployment still does not have, and this ADR does not pretend
otherwise.** Nobody can sign in unless a row in `allowed_domain` admits their
domain, and there is nothing to vote on, because poll authoring is not built
(`docs/plans/pulse.md` P6). The first of those is about to stop being true: the
operator decided on 2026-09-13 that pulse moves to open sign-up, which is its
own change and its own ADR.

**The root `docker-compose.yml` is untouched** and `just up` still starts
nothing. It is described by its own comment and by
`.claude/skills/odc-service-boundaries` as the **full stack of `services/`**,
and pulse is an app, not a service. `just pulse-up` is added instead, so the
"one command, repeatably" the operator asked for on 2026-08-25 exists without
redefining what the root compose is for.

**Neither image was built in the session that wrote them.** No Docker daemon
was available, so the Dockerfiles are reasoned and their inputs verified
individually — `pnpm deploy --prod` was run for real and confirmed to emit
production dependencies plus `migrations/`, and `migrationsDir()`'s upward walk
was traced against the runtime layout — but **the images themselves are
unproven and the first `docker build` is the test.** This is stated here rather
than left for someone to discover.

### Documents reconciled

- `apps/pulse/README.md` — gains a "Serve it" section with the four required
  variables. **Updated in this PR.**
- `apps/pulse/docker-compose.yml` — its header said "Database only — there is no
  Dockerfile for the pulse server yet", which this ADR makes false. **Updated in
  this PR.**
- `justfile` — gains `pulse-up` / `pulse-down`. **Updated in this PR.**
- `docs/plans/pulse.md` — the production entry point and the Dockerfile move out
  of the deploy list. **Updated in this PR.**
- `memory/pulse.md` — records "there is no Dockerfile anywhere in the
  repository, on any branch" and carries the deploy-blocker table. Memory
  entries are updated **on master at merge time** per `memory/INDEX.md`, so it
  is deliberately **not** touched here.
- ADR-0001 and `docs/implementation-plan.md` — both describe the **root**
  justfile and compose as the dev entry point for `services/`. Nothing here
  changes that, and the root compose is unchanged. Nothing to reconcile.

## Charter check

**Not applicable.** `apps/pulse` and `apps/pulse-web` are charter-exempt by
operator decision (`apps/pulse/CLAUDE.md`, `memory/INDEX.md`). The two
boundaries that survive the exemption both hold: nothing here reads from or
writes to `services/` or `contracts/` — the root compose that would join them
is deliberately untouched — and no copy introduced says anything about how a
tally is computed.
