# Deploy Pulse

This is the operator checklist for a small invited test. It deliberately does
not choose a host, create an account, buy anything, or change DNS.

Pulse is two images on one public origin:

- `apps/pulse/Dockerfile` is the private API. It runs on port `8080` by default,
  connects to Postgres, runs migrations, and sends mail through Resend.
- `apps/pulse-web/Dockerfile` is the public front door. nginx listens on port
  `8080`, serves the browser app, and proxies `/api` to `http://api:8080`.

The API must not be exposed directly. Keep both processes behind the web image
so the page and API share one origin; the session cookies depend on it.

By default nginx proxies `/api` to `api:8080` and resolves names through
Docker's DNS (`127.0.0.11`), which is what docker compose provides. Hosts with
another private-network name or resolver set `PULSE_API_UPSTREAM` and
`PULSE_DNS_RESOLVER` on the web service (see the Railway section). nginx
resolves the upstream name on requests with a 10-second cache, so the web
service can start before the API exists (requests return 502 until it does)
and an API address change needs no web restart. Changing the settings
themselves requires restarting the web container. The literal-name and
restart-on-address-change limits apply only to the compose defaults.

## Proxy configuration required before going live

The API trusts `PULSE_TRUSTED_PROXY_HOPS` private proxy hops for the client
address (default `1`: the shipped nginx; `src/main.ts`,
`src/http/server.ts`). With a host edge in front of nginx, one hop identifies
the edge as the client and puts every user in one shared rate-limit bucket.
Before using Render, Fly.io or another edge proxy, set
`PULSE_TRUSTED_PROXY_HOPS=2` — this works only when both nginx's address as
the API sees it and the edge address nginx appends to `X-Forwarded-For` pass
the API's private address check — or configure nginx's real-IP handling for
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
preloading is a separate operator decision. Do not add HSTS to the internal
HTTP nginx listener.

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

The web container has no runtime environment variables and listens publicly on
port `8080`. Four optional build arguments publish the starting-question poll
IDs used by `/questions`:

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

Attach the hostname to the public web service, not the API service. Wait for the
host to provision TLS, then set `PULSE_WEB_ORIGIN` to the exact HTTPS origin.
Verify that `/` and `/api/polls?community=pulse-general` work at that same
origin before sending an invitation.

## Railway

The chosen host (operator, 2026-11-15). Railway documents its private network
at <https://docs.railway.com/guides/private-networking> and its public edge at
<https://docs.railway.com/networking/public-networking/specs-and-limits.md>.
Anything below not tied to one of those pages is marked "verify on the first
deploy".

### Services

Create three services in one Railway project and environment: Postgres, the
API, and the web.

1. **Postgres:** Railway Postgres, major version 17, UTF8. After it starts, run
   `show server_encoding;` and confirm `UTF8` (see "Postgres" above).
2. **API:** build from the repository root (the Dockerfiles copy workspace
   files from the root) and set the service variable
   `RAILWAY_DOCKERFILE_PATH=apps/pulse/Dockerfile`. Give it **no public
   domain**. Run exactly **one replica**: rate limits are per instance, so a
   second replica would let each client have a separate budget per replica.
3. **Web:** build from the repository root with
   `RAILWAY_DOCKERFILE_PATH=apps/pulse-web/Dockerfile`. This is the only
   service with a public domain; set its target port to `8080`. Attach the
   chosen hostname here (see "Point the public hostname at the host"). Set the
   health check to `GET /`.

Pass the `VITE_PULSE_*_POLL_ID` build arguments (see "Web image build and
port") as service variables if the starting questions are published; whether
Railway passes a service variable to the Docker build as a build argument must
be verified on the first deploy.

### Web service settings

| Setting                | Value                                      |
| ---------------------- | ------------------------------------------ |
| `PULSE_API_UPSTREAM`   | `<api-service-name>.railway.internal:8080` |
| `PULSE_DNS_RESOLVER`   | `[fd12::10]`                               |
| `PULSE_REAL_IP_HEADER` | `X-Real-IP`                                |

Use the API service's actual name in `PULSE_API_UPSTREAM`; no `http://`, path
or trailing slash. Railway's private network is IPv6, and environments created
before 2025-10-16 are IPv6-only; `[fd12::10]` is the resolver address in
Railway's private-networking guide. The web image serves on IPv4 and IPv6, so
Railway's edge can reach it either way.

### API service settings

Set every variable under "API environment" above, plus:

| Setting                    | Value                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `PULSE_HOST`               | `::` (bind IPv6 so the web service can reach the API on the private network) |
| `PULSE_TRUSTED_PROXY_HOPS` | `1`                                                                          |
| `PULSE_DATABASE_URL`       | the Postgres service's private (internal) connection URL                     |

Leave `PULSE_PORT` unset (`8080`). `PULSE_TRUSTED_PROXY_HOPS=1` is correct here
because the web nginx replaces the forwarded address with the one real client
address (below), so the API sees one proxy hop. Do not use `2`.
`PULSE_WEB_ORIGIN` must be the exact HTTPS public origin; set it after the
hostname's TLS works. Production cookies are named `__Host-pulse_session` and
`__Host-pulse_ballot` (`apps/pulse/API.md`); the browser rejects `__Host-`
cookies over plain HTTP, so sign-in cannot work until the public origin is
HTTPS. Railway terminates TLS at its edge; confirm HTTPS on the hostname before
inviting anyone.

### Real client address and what it trusts

With `PULSE_REAL_IP_HEADER=X-Real-IP`, nginx takes the client address from
`X-Real-IP` from any peer (Railway publishes no edge address ranges), and
Railway's edge overwrites that header with the actual client address on public
requests. That is safe only because the edge is the only thing that reaches the
web port. Any other service in the same Railway environment can reach the web
service over the private network and send its own `X-Real-IP`, choosing its own
rate-limit bucket. Keep no untrusted services in this environment, and do not
give the web service a TCP proxy or any second public route.

### Deploying a release

Railway starts the new deployment before stopping the old one (verify on the
first deploy; Railway's deployment-overlap settings may change this). That
conflicts with the rule under "Postgres": do not overlap old and new API
versions during a schema change. The old code could write against, or choke on,
the new schema while the new code runs migrations.

- **Release with a schema change (any new migration):** scale the API to 0
  replicas or remove its running deployment first, then deploy the new version
  and scale back to 1. Accept the short outage. Check the deploy logs to see
  the migrations finish before opening traffic.
- **Release with no migration:** a normal redeploy is fine.
- **Additive migrations still need care.** If the release adds a column or
  table, the old code that is still running during an overlap must tolerate it
  (it ignores columns it does not know). Treat a migration as safe to overlap
  only after reading it for that; when unsure, use the outage procedure.

The web service has no schema and may redeploy at any time; nginx re-resolves
the API address, so no web restart is needed after an API redeploy.

### Check after deploy

1. `/` loads at the public HTTPS origin and `GET /api/polls?community=pulse-general`
   returns `200` JSON (see "Health checks").
2. Request a real sign-in link at an invited address and redeem it; confirm the
   `__Host-pulse_session` cookie is set.
3. Rate-limit buckets: request sign-in links from two different networks
   (for example a home connection and a phone off Wi-Fi) until one is limited
   and confirm the other is still accepted. If both hit the limit together,
   every user is in one bucket: stop and check the proxy settings above.
4. Spoofing: from one client, send requests with a forged
   `X-Real-IP: <other address>` header (and `X-Forwarded-For`) and confirm its
   own bucket is unchanged, so it is limited at the same point as without the
   header and the other client is unaffected. Railway's edge should overwrite
   the header; verify on the first deploy.

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
  web service as exactly `api`. If its private hostname differs, the current web
  image cannot proxy to it without a follow-up nginx/configuration change.
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
- Before deployment, prove that the web Machine resolves the bare name `api` to
  the API. If Fly exposes only an address such as `<app>.internal`, the current
  web image needs a follow-up nginx/configuration change before Fly is usable.
- Do not overlap old and new API Machines during a schema-changing deployment;
  stop the old API, start the new one, and let startup migrations finish before
  admitting traffic.
