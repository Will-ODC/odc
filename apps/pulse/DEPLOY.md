# Deploy Pulse

This is the operator checklist for a small invited test. It does not create an
account, buy anything, or change DNS.

Pulse is two images on one public origin:

- `apps/pulse/Dockerfile` is the private API. It runs on port `8080` by default,
  connects to Postgres, runs migrations, and sends mail through Resend.
- `apps/pulse-web/Dockerfile` is the public front door. nginx listens on port
  `8080`, serves the browser app, and proxies `/api` to the configured API
  upstream (`api:8080` by default).

The API must not be exposed directly. Keep both processes behind the web image
so the page and API share one origin; the session cookies depend on it.

By default nginx proxies `/api` to `api:8080` and resolves names through
Docker's DNS (`127.0.0.11`), which is what docker compose provides. Hosts with
another private-network name or resolver set `PULSE_API_UPSTREAM` and
`PULSE_DNS_RESOLVER` on the web service (see the Railway section). nginx
resolves the upstream name on requests with a 10-second cache, so the web
service can start before the API exists (requests return 502 until it does)
and an API address change needs no web restart. Changing the settings
themselves requires restarting the web container.

## Proxy configuration required before going live

The API trusts `PULSE_TRUSTED_PROXY_HOPS` private proxy hops for the client
address (default `1`: the shipped nginx; `src/main.ts`,
`src/http/server.ts`). With a host edge in front of nginx, one hop identifies
the edge as the client and puts every user in one shared rate-limit bucket.
Before using Render, Fly.io or another edge proxy, set
`PULSE_TRUSTED_PROXY_HOPS=2` (Railway: keep `1` with
`PULSE_REAL_IP_HEADER`; see the Railway section) — this works only when both
nginx's address as the API sees it and the edge address nginx appends to
`X-Forwarded-For` pass the API's private address check — or configure nginx's real-IP handling for
the host's trusted edge addresses and keep `1`. The value must be a whole
number from 1 to 4; anything else, including `0`, stops the start (the served
API is only reached through nginx, so trusting no hop would make nginx's
address everyone's). Do not trust arbitrary forwarded headers. Verify that two
clients get distinct rate-limit buckets and cannot spoof their address.

## HTTPS and browser security headers

The web nginx listens only on HTTP port `8080`; terminate HTTPS at the host's
edge proxy. Set `Strict-Transport-Security: max-age=31536000` on HTTPS responses
at that TLS terminator, including API and error responses, and redirect public
HTTP traffic to HTTPS there. Enable HSTS only once HTTPS works on the chosen
hostname. Add `includeSubDomains` only if every subdomain is ready for HTTPS;
preloading is a separate operator decision. Do not send HSTS unconditionally
from the internal HTTP listener; #691 sends it only when the edge reports
HTTPS. See the Railway section for its current HSTS gap and follow-up #691.

nginx sends CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`
and a Permissions-Policy denying camera, microphone and geolocation on pages,
assets, proxied API responses and errors. The page's earlier `no-referrer` meta
policy remains stricter to protect sign-in tokens. The CSP allows same-origin
scripts and fonts, and inline styles required by the results/charts; it denies
framing and object embeds. Inter is bundled locally, with no font-host requests.
`server_tokens off` suppresses the nginx version. The shared header include must
stay in every location if cache headers or new locations are added.

## Open operator questions

Nothing in this runbook answers these questions:

1. **Which host?** Railway (operator, 2026-11-15). See the Railway section.
   Render and Fly.io are kept below as alternatives.
2. **Which public hostname?** Options: the root
   (`https://onlinedemocracy.org`) or a product subdomain such as
   `https://pulse.onlinedemocracy.org`.
3. **Which domain sends mail?** Options: the public hostname, a dedicated
   subdomain such as `mail.onlinedemocracy.org`, or another subdomain. The From
   address must use the domain that is verified in Resend.

## Postgres

Provision persistent managed Postgres and give the API a connection string in
`PULSE_DATABASE_URL`. PostgreSQL 17 is the version used by the repository's
Compose setup; using another major version needs separate verification. Do not
use the Compose database for a deployment: its data directory is a temporary
filesystem.

The database must use the UTF8 server encoding. Pulse's text limits
(question, choices, names, picture descriptions) are counted in code points,
and under `SQL_ASCII` Postgres counts bytes instead, so valid non-ASCII text
can break a check constraint and fail as a 500. Check with `show
server_encoding;`.

The database user needs permission to create and change tables in the selected
schema. Set `PULSE_DATABASE_SCHEMA` only when Pulse should use a non-default
schema. Backups, retention, restore testing, TLS requirements, and connection
limits are host/database-operator settings rather than application settings.

Migrations run automatically before the API starts listening. They take a
Postgres advisory lock, skip already-applied files, and refuse changed or
out-of-order migrations. For an upgrade, stop all old API instances before
starting the new version; do not use a rolling API deployment that overlaps old
and new code.

### Sign-in link retention

`pending_claim` rows are deleted when redeemed. An expired, unused row is
eligible for removal once it expires. Eligible rows are removed at the next
API startup, link redemption or sign-in-link request. There is no scheduler
and no extra environment variable: with no restart, redemptions or sign-in
link requests, expired rows remain until the next one. The sweep uses the same
application clock as link expiry, and does not change the 15-minute link
lifetime. A failed sweep at startup or redemption is logged as a fault and
does not stop the API starting or fail that redemption; the sweep inside a
sign-in-link request runs in the request's own transaction, so a failure there
fails that request.

Migration 010 removes previously used pending rows. A separate `used_claim`
table retains only spent token digests and application timestamps, with no
address, community or opt-in, to preserve the "already used" response.
Migration 012 adds the timestamp. A marker is eligible for removal 20 minutes
after use (the link's 15-minute lifetime plus a five-minute margin) and is
removed at the next API startup or link redemption; sign-in-link requests do
not remove markers, so on an idle deployment they can likewise remain past
that window. A pre-012 marker is dated at the first startup or redemption
after upgrading and retained for the full window from then. Account email credentials and database backups have separate
retention; this cleanup does not erase them from backups.

### Poll pictures (ADR-0047)

Uploaded poll pictures are stored in this database: `image` holds each
picture's size, owner link and description, `image_bytes` its two re-encoded
WebP variants (about 150–300 KB and 15–30 KB). The original upload is never
stored. **Database backups therefore contain picture bytes and descriptions,
including pictures later removed or purged, for the backup retention period.**
Plan backup size and retention with that in mind.

A picture uploaded but not attached to a poll within 24 hours is deleted with
its bytes at the next API startup or upload. Like the sign-in sweep there is
no scheduler; a failed sweep is logged and never stops startup or an upload.
The same sweep removes `image_upload` rows (an account id and upload time,
which the hourly upload quota counts) once they are more than an hour old.

The API image includes `sharp` (libvips) with prebuilt `linuxmusl-x64`
binaries for the Alpine runtime; a libvips advisory means rebuilding the
image. Picture decoding runs one at a time per instance, and a busy instance
answers 503 `image_busy` rather than slowing votes.

The web image's nginx allows a request body of 10 MiB on `POST
/api/poll-images` only; every other location keeps nginx's 1 MiB default. A
proxy or host edge in front of nginx must allow 10 MiB on that path too.
[Railway documents](https://docs.railway.com/networking/public-networking/specs-and-limits.md)
no request-body size limit, only that requests must finish within 5 minutes;
verify a 10 MiB `POST /api/poll-images` on the first deploy.

Until reporting and the site owner's soft delete are built, the only
emergency path for an abusive picture is a database operator setting the
poll's existing `hidden` flag (`update polls set hidden = true where id =
…`), which hides the poll and so its picture; served copies leave browser
caches within an hour. Record by hand that this was done.

## API environment

Blank values count as unset. The production server reads only the variables
below; it ignores ambient `DATABASE_URL`, `RESEND_API_KEY`, and `PORT`.

- `PULSE_SESSION_SECRET` (required): stable secret that signs session and ballot
  cookies. It must be at least 32 characters; the API refuses to start with a
  shorter one. Generate one with `openssl rand -base64 48`. Store it as a
  secret; changing it signs everyone out.
- `PULSE_CONFIRMATION_KEY` (required): HMAC key for confirmed-voter codes. It
  must be at least 32 characters and different from the session secret.
  Changing it makes earlier confirmations unrecognisable.
- `PULSE_DATABASE_URL` (required): Postgres connection string, including any
  provider-required TLS parameters.
- `PULSE_RESEND_API_KEY` (required): Resend API credential used to send real
  sign-in mail. Store it as a secret.
- `PULSE_WEB_ORIGIN` (required): exact public bare origin, such as
  `https://pulse.onlinedemocracy.org`; no path or trailing slash. It is used in
  emailed links and is the only accepted Origin for sign-in, link redemption,
  sign-out and poll-creation mutations.
- `PULSE_MAIL_FROM` (required): From identity on the verified sending domain,
  for example `Pulse <sign-in@mail.onlinedemocracy.org>`.
- `PULSE_MAIL_REPLY_TO` (optional): Reply-To address. If unset, no Reply-To is
  sent.
- `PULSE_DATABASE_SCHEMA` (optional): Postgres schema to use. Unset uses the
  connection's default schema.
- `PULSE_OWNER_EMAIL` (optional): normalised email of the owner who may grant
  unlimited posting. Unset means no owner; an invalid address stops startup.
- `PULSE_PORT` (optional): API listen port; defaults to `8080`. The app does not
  read the common host variable `PORT`.
- `PULSE_HOST` (optional): API bind address; defaults to `0.0.0.0`.

Source references (relative to `apps/pulse/`):

| Setting                  | Source                             |
| ------------------------ | ---------------------------------- |
| `PULSE_SESSION_SECRET`   | `src/main.ts:111`                  |
| `PULSE_CONFIRMATION_KEY` | `src/main.ts:122`                  |
| `PULSE_DATABASE_URL`     | `src/db/config.ts:23`              |
| `PULSE_RESEND_API_KEY`   | `src/identity/resend-mailer.ts:58` |
| `PULSE_WEB_ORIGIN`       | `src/main.ts:118`                  |
| `PULSE_MAIL_FROM`        | `src/identity/resend-mailer.ts:61` |
| `PULSE_MAIL_REPLY_TO`    | `src/identity/resend-mailer.ts:70` |
| `PULSE_DATABASE_SCHEMA`  | `src/main.ts:165`                  |
| `PULSE_OWNER_EMAIL`      | `src/authoring/owner.ts:14`        |
| `PULSE_PORT`             | `src/main.ts:168`                  |
| `PULSE_HOST`             | `src/main.ts:169`                  |

Generate the two application secrets independently and keep them stable across
deploys. The confirmation key is sensitive alongside the database because the
pair can reveal which confirmed person cast a vote.

## Web image build and port

The web container listens publicly on port `8080` and reads the runtime
settings `PULSE_API_UPSTREAM`, `PULSE_DNS_RESOLVER` and `PULSE_REAL_IP_HEADER`
(see `apps/pulse-web/README.md`, "Web container runtime settings"). The poll IDs below are build-time only; four
optional build arguments publish the starting-question poll IDs used by
`/questions`:

- `VITE_PULSE_FIRST_POLL_ID`
- `VITE_PULSE_DATA_POLL_ID`
- `VITE_PULSE_FUNDING_POLL_ID`
- `VITE_PULSE_REVOTE_POLL_ID`

If they are omitted, those starting questions show as coming soon. They are
Vite build-time values, so changing one requires rebuilding the web image.
The mappings are in `apps/pulse-web/src/main.tsx:22-34`.

## Health checks

There is no dedicated health endpoint. Configure the host's basic web health
check as `GET /` on the web container's port `8080`. After each deploy, make an
end-to-end check through the public origin:

```text
GET /api/polls?community=pulse-general
```

A `200` JSON response checks nginx routing, API startup, and a database query.
Also request a real sign-in link at an invited address before admitting the
pilot; a page/API check does not prove mail delivery.

## Verify the Resend sending domain

Do this only after the operator chooses the sending subdomain and a Resend
account exists:

1. Add the chosen domain in Resend and select its sending region if prompted.
2. In DNS, add the records shown for that exact domain in the Resend dashboard.
   The required authentication records are:
   - **DKIM:** a `TXT` record at the selector Resend supplies (commonly
     `resend._domainkey.<sending-domain>`) whose value is the supplied DKIM
     public key.
   - **SPF:** a `TXT` record at the mail-from name Resend supplies (commonly
     `send.<sending-domain>`) whose value is the supplied SPF policy (commonly
     `v=spf1 include:amazonses.com ~all`).
   - Add the matching MX record for the custom mail-from name if Resend lists
     one. It supports SPF alignment and is separate from mailboxes for the root
     domain.
3. Copy the dashboard's names and values exactly rather than copying the
   examples above; selectors, region endpoints, and provider instructions can
   change. If a DNS provider automatically appends the zone name, enter only
   the host portion to avoid duplicating the domain.
4. Wait until Resend reports DKIM and SPF as verified. Then set
   `PULSE_MAIL_FROM` to an address on that verified domain and make a real
   delivery test. Do not publish a second SPF record at a name that already has
   one; merge authorised senders into a single SPF policy instead.

DMARC is recommended for operational mail but is a separate policy choice from
the SPF/DKIM records Pulse needs to send.

## Point the public hostname at the host

After the host and public hostname are chosen, add only the record the host
assigns:

- For a subdomain, this is usually a `CNAME` to the host-provided target.
- For the root domain, use the host's documented `A`/`AAAA`, `ALIAS`, or
  flattening target; a normal root `CNAME` is not supported by every DNS
  provider.

Attach the hostname to the public web service, not the API service. Set
`PULSE_WEB_ORIGIN` to the exact HTTPS origin from the start; the API requires
it to start. If the origin changes on Railway, change the variable and deploy
the staged change. Wait for the host to provision TLS, then verify that `/` and
`/api/polls?community=pulse-general` work at that same origin before sending an
invitation.

## Railway

The chosen host (operator, 2026-11-15). Verify the networking and application
checks below on the first deploy.

### Services

Create three services in one Railway project and environment: Postgres, the
API, and the web. Decide the origin first. If you will test on the generated
domain, create the web service and generate its domain before setting the API
variables, or set
`PULSE_WEB_ORIGIN=https://${{<web-service>.RAILWAY_PUBLIC_DOMAIN}}` using the
web service's actual name. For a custom hostname, set the literal origin,
not this reference. Verify on the first deploy that the domain and variable
reference are configured as expected.

1. **Postgres:** add Railway Postgres; verify on the first deploy that it is
   major version 17 and UTF8: `railway ssh --service Postgres`, then
   `psql -U postgres -c 'show server_version;' -c 'show server_encoding;'`
   (or use the service's Data tab). Expect 17.x and UTF8. Give the API the
   private URL through
   `PULSE_DATABASE_URL=${{Postgres.DATABASE_URL}}`, not `DATABASE_PUBLIC_URL`;
   check the variable name on the Postgres service. See Railway's
   [variable reference syntax](https://docs.railway.com/reference/variables).
   Confirm Settings → Networking shows no Public Access / TCP proxy
   ([Railway databases are private by default](https://docs.railway.com/databases/postgresql));
   remove one if present.
2. **API:** immediately after creating the API service from the repository,
   before setting its variables, disable automatic deploys
   ([Railway's GitHub auto-deploy guide](https://docs.railway.com/deployments/github-autodeploys)
   says "Click Disable"; the control is in the service's Settings, Source
   section — verify on the first deploy). Railway may start a build as soon
   as the repository is connected; it fails until `RAILWAY_DOCKERFILE_PATH`
   is set, which is expected (verify on the first deploy). Build from the
   repository root (the Dockerfiles copy workspace files from the root) and
   set `RAILWAY_DOCKERFILE_PATH=apps/pulse/Dockerfile`; see
   [Railway's Dockerfile guide](https://docs.railway.com/guides/dockerfiles).
   Give it **no public domain**. Run exactly **one replica**: rate limits are
   per instance, so a second replica would let each client have a separate
   budget per replica. Verify these settings on the first deploy.
   Set its health check to `GET /api/polls?community=pulse-general` and its
   service variable `PORT=8080` so Railway checks the API's listening port
   (the API ignores `PORT`). A failed new API stays unpromoted, so a bad build
   in a release with no migration does not take the site down; see
   [Railway's health check guide](https://docs.railway.com/guides/healthchecks).
   Verify on the first deploy that the health check passes on a service with
   no public domain and with a query string in the path. If it does not, clear
   the API health check and rely on check 1 under "Check after deploy".
3. **Web:** build from the repository root with
   `RAILWAY_DOCKERFILE_PATH=apps/pulse-web/Dockerfile`. This is the only
   service with a public domain; set its target port to `8080`. Attach the
   chosen hostname here (see "Point the public hostname at the host"). Set the
   health check to `GET /`. Set the service variable `PORT=8080` on the web
   service so Railway's deploy health check reaches nginx (nginx ignores it).
   Railway uses the injected `PORT` for the check and runs it only at deploy
   time; it is not monitoring. See Railway's
   [health check guide](https://docs.railway.com/guides/healthchecks).

Pass the `VITE_PULSE_*_POLL_ID` build arguments (see "Web image build and
port") as service variables if the starting questions are published.
[Railway's Dockerfile guide](https://docs.railway.com/guides/dockerfiles) says
service variables are available at build time when declared with `ARG` in the
stage that needs them. `apps/pulse-web/Dockerfile` declares all four `VITE_`
arguments; verify the starting questions appear on `/questions`.

### Web service settings

| Setting                | Value                                      |
| ---------------------- | ------------------------------------------ |
| `PULSE_API_UPSTREAM`   | `<api-service-name>.railway.internal:8080` |
| `PULSE_DNS_RESOLVER`   | `[fd12::10]`                               |
| `PULSE_REAL_IP_HEADER` | `X-Real-IP`                                |

Use the API service's actual name in `PULSE_API_UPSTREAM`; no `http://`, path
or trailing slash. `[fd12::10]` is the nameserver in Railway containers'
`/etc/resolv.conf` according to Railway community answers; it is not in
Railway's docs and may change. Verify it on the first deploy: use `railway ssh`
into the web service and run `cat /etc/resolv.conf`. If the resolver is wrong,
`/` loads but every `/api` request returns 502.

[Railway's private-networking guide](https://docs.railway.com/networking/private-networking/how-it-works)
says environments created after 2025-10-16 resolve private names to IPv4 and
IPv6; older environments resolve them to IPv6 only. The web image serves on
IPv4 and IPv6, so Railway's edge can reach it either way.

### API service settings

Set every variable under "API environment" above, plus:

| Setting                    | Value                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `PULSE_HOST`               | `::` (bind IPv6 so the web service can reach the API on the private network) |
| `PULSE_TRUSTED_PROXY_HOPS` | `1`                                                                          |
| `PULSE_DATABASE_URL`       | `${{Postgres.DATABASE_URL}}` (private URL; check the Postgres variable name) |

Leave `PULSE_PORT` unset (`8080`). `PULSE_TRUSTED_PROXY_HOPS=1` is correct here
because the web nginx replaces the forwarded address with the one real client
address (below), so the API sees one proxy hop. Do not use `2`.

In a dual-stack environment, nginx may reach the API over private IPv4.
[Railway documents no private IPv4 range](https://docs.railway.com/networking/private-networking/how-it-works).
If the address is outside `10/8`, `172.16/12` and `192.168/16` (for example,
`100.64/10`), the API's private-proxy check (`src/http/server.ts:65-69`) rejects
nginx as a trusted proxy and every user shares one rate-limit bucket. The
post-deploy bucket check below detects this.

`PULSE_WEB_ORIGIN` is required for the API to start. Set it from the start to
the exact HTTPS origin people will use: the custom hostname, or the generated
`https://<name>.up.railway.app` domain for a first test. If the origin changes,
change the variable and deploy the staged change. A staged deploy starts a
new API deployment that overlaps the old one (see
[Railway's deployment teardown docs](https://docs.railway.com/deployments/deployment-teardown)).
Before deploying it, check for new migrations as in "Deploying a release"; if
there are any, remove the active deployment first. Verify on the first deploy
which commit a staged deploy builds. Sign-in links point at the origin and
mutations are accepted only from it, so check HTTPS works there. Production
cookies are named `__Host-pulse_session` and
`__Host-pulse_ballot` (`apps/pulse/API.md`); the browser rejects `__Host-`
cookies over plain HTTP.

[Railway's edge](https://docs.railway.com/networking/public-networking/specs-and-limits.md)
terminates TLS and answers plain-HTTP GET requests with a 301 redirect to
HTTPS. Railway offers no way to add response headers (not in Railway's docs;
verify on the first deploy), so the HSTS requirement under "HTTPS and browser
security headers" is not met on Railway yet.
[Ticket #691](https://github.com/Will-ODC/odc/issues/691) covers having nginx
send HSTS when the edge reports HTTPS.

### Real client address and what it trusts

With `PULSE_REAL_IP_HEADER=X-Real-IP`, nginx takes the client address from
`X-Real-IP` from any peer (Railway publishes no edge address ranges; verify
on the first deploy).
[Railway's edge](https://docs.railway.com/networking/public-networking/specs-and-limits.md)
is documented as setting `X-Real-IP` to the client address; replacing a value
the client sent is not documented. Verify this on the first deploy with check
4 under "Check after deploy". This also depends on the edge being the only
public route to the web port. Any other service in the same Railway
environment can reach the web service over the private network and send its
own `X-Real-IP`, choosing its own rate-limit bucket. Keep no untrusted
services in this environment, and do not give the web service a TCP proxy or
any second public route.

### Deploying a release

With API automatic deploys disabled during setup, start every API release by
hand. [Railway's deployment teardown docs](https://docs.railway.com/deployments/deployment-teardown)
say the old deployment stops after the new one deploys, with the overlap set
by `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`. This conflicts with the rule under
"Postgres" during a schema change: the old code could write against, or choke
on, the new schema while migrations run.

Before each API release, check for a new migration. `<deployed-sha>` is the
commit shown on the API's active deployment:

```sh
git diff --name-only <deployed-sha> <new-sha> -- apps/pulse/migrations
```

- **Release with a schema change (any new migration):** remove the API's active
  deployment first: in the Deployments tab, open its three-dot menu and choose
  **Remove** (verify on the first deploy), or run
  `railway down --service <api-service-name>`.
  [The CLI command](https://docs.railway.com/cli/down) removes the most recent
  successful deployment. Wait until the deployment shows removed, then deploy
  the new version as described below. Accept the outage and watch the deploy
  logs until the migrations finish and the API is listening. Do not use
  **Rollback** or **Redeploy** of an older deployment after a migration has
  run (Rollback restores the previous image and variables, per
  [Railway's deployment actions](https://docs.railway.com/deployments/deployment-actions));
  fix forward with a new commit.
- **Release with no new migration:** deploy the new version as described
  below; the old deployment can keep serving until the new API passes its
  health check.

To deploy the new version, open the command palette (Cmd+K) with the API
service selected and choose **Deploy Latest Commit**.
[Railway's deployment actions](https://docs.railway.com/deployments/deployment-actions)
say it deploys the latest commit of the repository's default branch
(`master`); keep the API service connected to `master`. Verify on the first
deploy that it works with automatic deploys disabled. Make sure that tip is
the `<new-sha>` you diffed; if the branch moved, diff again and follow the
matching release procedure above before deploying. Do not use **Redeploy**
for a new version: it reuses the selected deployment's source (see deployment
actions above).

The web service has no schema and may redeploy at any time; nginx re-resolves
the API address, so no web restart is needed after an API redeploy.

### Check after deploy

1. `/` loads at the public HTTPS origin and `GET /api/polls?community=pulse-general`
   returns `200` JSON (see "Health checks").
2. Request a real sign-in link at an invited address and redeem it; confirm the
   `__Host-pulse_session` cookie is set.
3. Rate-limit buckets: use two different networks (for example a home
   connection and a laptop on a phone's mobile hotspot). Use networks that
   have made no sign-in request in the last hour (check 2 counts as one),
   and send the following request eleven times from the first network,
   replacing `https://<origin>` with the exact public origin in both places:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<origin>/api/sign-in -H 'Origin: https://<origin>' -H 'Content-Type: application/json' -d '{"email":"not-an-address"}'
   ```

   Expect ten 400s, then 429 `too_many_requests`. The other network must still
   get 400; send the same request there and complete eleven requests in total
   to check its own ten-then-429 count. No mail is sent. Each tested network
   stays limited for an hour. If both networks hit the limit together, every
   user is in one bucket: check the proxy settings above, including whether
   nginx's private IPv4 address passes the API's private-proxy check. A 403
   on every request means the Origin header does not exactly match
   `PULSE_WEB_ORIGIN`; fix it and wait an hour.

4. Spoofing: once the buckets are fresh again (wait an hour), repeat the same
   test with `-H 'X-Real-IP: 203.0.113.9' -H 'X-Forwarded-For: 203.0.113.9'`
   added to the curl command. Expect the same ten 400s then 429 count on each
   network, with the other network still getting 400 after the first is
   limited. This checks that forged headers cannot change the client's bucket.

### Before inviting anyone

- All checks under "Check after deploy" pass.
- Check 4 confirms forged headers cannot change the client's bucket.
- #691 is merged and deployed, and HTTPS responses include HSTS.

## Render

Written before the web image's runtime settings (`PULSE_API_UPSTREAM`,
`PULSE_DNS_RESOLVER`, `PULSE_REAL_IP_HEADER`) existed; check it against them
before use.

- Create a managed Postgres database and a private Docker service for the API
  using `apps/pulse/Dockerfile`. Configure the API variables above and keep the
  service off the public internet.
- Create a public Docker web service from `apps/pulse-web/Dockerfile`, expose
  port `8080`, and attach the chosen custom hostname to it.
- Before deployment, confirm Render makes the API service resolvable from the
  web service. Set `PULSE_API_UPSTREAM` to its private hostname and port, and
  `PULSE_DNS_RESOLVER` to the resolver available inside the web container
  (see "Web image build and port").
- Use a deployment strategy that stops old API instances before the new API
  starts and runs its migrations.

## Fly.io

Written before the web image's runtime settings (`PULSE_API_UPSTREAM`,
`PULSE_DNS_RESOLVER`, `PULSE_REAL_IP_HEADER`) existed; check it against them
before use.

- Run the API and web images as separate private-networked apps or Machine
  groups, with managed Postgres reachable only by the API. Expose only the web
  service on port `8080` and attach the chosen hostname there.
- Set API secrets with Fly's secret mechanism and non-secret settings as
  environment variables. Keep the API's internal port at `8080` unless
  `PULSE_PORT` and routing are changed together.
- Before deployment, set `PULSE_API_UPSTREAM` to the API's private hostname
  and port (such as `<app>.internal:8080`) and `PULSE_DNS_RESOLVER` to the
  resolver available inside the web Machine. Confirm the web Machine can
  resolve that hostname (see "Web image build and port").
- Do not overlap old and new API Machines during a schema-changing deployment;
  stop the old API, start the new one, and let startup migrations finish before
  admitting traffic.
