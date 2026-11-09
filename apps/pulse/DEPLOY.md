# Deploy Pulse

This is the operator checklist for a small invited test. It deliberately does
not choose a host, create an account, buy anything, or change DNS.

Pulse is two images on one public origin:

- `apps/pulse/Dockerfile` is the private API. It runs on port `8080` by default,
  connects to Postgres, runs migrations, and sends mail through Resend.
- `apps/pulse-web/Dockerfile` is the public front door. nginx listens on port
  `8080`, serves the browser app, and proxies `/api` to `http://api:8080`.

The API must not be exposed directly. The host's private network must resolve
the literal name `api` to the API service, because that name is compiled into
the current nginx configuration. Keep both processes behind the web image so
the page and API have one origin; the session cookies depend on it.

nginx resolves `api` when it starts and will not start if the name does not
resolve (`host not found in upstream`). Start the API first, or expect the web
container to restart until the API is up; Fly `.internal` names resolve only
for running Machines. Restart the web container if the API's address changes;
the current configuration does not refresh DNS dynamically.

## Proxy configuration required before going live

The API currently trusts one private proxy hop (`src/main.ts:327`,
`src/http/server.ts:146-160`). With a host edge in front of nginx, that can
identify the edge as the client and put users in a shared rate-limit bucket.
Before using Render, Fly.io or another edge proxy, adapt and test the trusted
proxy configuration for that host: either trust two verified private hops in
the API, or configure nginx's real-IP handling for the host's trusted edge
addresses. Two hops work only when both proxy addresses pass the API's private
address check. Do not trust arbitrary forwarded headers. Verify that two
clients get distinct rate-limit buckets and cannot spoof their address.
There is no environment variable for changing the hop count today.

## Open operator questions

Nothing in this runbook answers these questions:

1. **Which host?** Options: Render, Fly.io, or another container host with a
   private network, managed Postgres, persistent secrets, TLS, and custom
   domains.
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

The database user needs permission to create and change tables in the selected
schema. Set `PULSE_DATABASE_SCHEMA` only when Pulse should use a non-default
schema. Backups, retention, restore testing, TLS requirements, and connection
limits are host/database-operator settings rather than application settings.

Migrations run automatically before the API starts listening. They take a
Postgres advisory lock, skip already-applied files, and refuse changed or
out-of-order migrations. For an upgrade, stop all old API instances before
starting the new version; do not use a rolling API deployment that overlaps old
and new code.

## API environment

Blank values count as unset. The production server reads only the variables
below; it ignores ambient `DATABASE_URL`, `RESEND_API_KEY`, and `PORT`.

- `PULSE_SESSION_SECRET` (required): stable secret that signs session and ballot
  cookies. Store it as a secret; changing it signs everyone out.
- `PULSE_CONFIRMATION_KEY` (required): HMAC key for confirmed-voter codes. It
  must be at least 32 characters and different from the session secret.
  Changing it makes earlier confirmations unrecognisable.
- `PULSE_DATABASE_URL` (required): Postgres connection string, including any
  provider-required TLS parameters.
- `PULSE_RESEND_API_KEY` (required): Resend API credential used to send real
  sign-in mail. Store it as a secret.
- `PULSE_WEB_ORIGIN` (required): exact public bare origin, such as
  `https://pulse.onlinedemocracy.org`; no path or trailing slash. It is used in
  emailed links and is the only accepted Origin for poll-creation mutations.
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

## Render

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
