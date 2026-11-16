# Pulse auth audit — 2026-11-15

Independent read-only audit by Codex (gpt-6.1-sol) at master `3ab2fcb`, before the Railway deploy. Triage by Claude: finding 1 confirmed in code (BLOCKING, #681); finding 2 lowered to SHOULD (needs prior cookie theft; #678); findings 3-4 after pilot (#679, #680); 5-6 in #683; 7 and the Railway notes in #682.

```text
VERDICT: FIX-BEFORE-PILOT

Passwords: No Pulse user password is accepted, stored, hashed or compared in apps/pulse/src, apps/pulse/migrations or apps/pulse-web/src. Authentication uses email magic links and signed cookies. References to URL.password reject embedded URL credentials.

Findings, ranked:

1. [BLOCKING] Automatic redemption permits login CSRF and disclosure of votes.
Evidence: apps/pulse-web/src/hooks/use-redeem.ts:40; apps/pulse/src/http/server.ts:454; apps/pulse/src/http/server.ts:464; apps/pulse/src/voting/pg-store.ts:350.
Scenario: An attacker requests a link for their own email and persuades a victim to open it. Pulse automatically POSTs the token from its own origin, signs the victim into the attacker’s account, and confirms the victim browser’s existing open-poll votes under that account. The attacker can subsequently retrieve newer victim answers through the existing cross-browser ballot-transfer logic, using a browser holding older anonymous answers on those polls. The Origin check passes because Pulse’s own page performs redemption.
Fix: Bind redemption to a browser nonce established when requesting the link. Provide a deliberate, clearly identified account-confirmation flow for cross-device use. Do not silently switch accounts or associate existing votes merely because a URL was opened.

2. [BLOCKING] Sign-out leaves copied ballot credentials usable.
Evidence: apps/pulse/src/http/server.ts:280; apps/pulse/src/http/server.ts:520; apps/pulse/src/http/server.ts:544; apps/pulse/src/http/server.ts:606; apps/pulse/src/voting/pg-store.ts:241.
Scenario: An attacker copies pulse_ballot before the victim signs out. Account-session revocation succeeds, but the copied ballot cookie still reads vote history and changes open ballots until its original expiry, up to 30 days. Changing a ballot without a session preserves its confirmed status. Clearing the victim’s browser cookie does not invalidate the attacker’s copy.
Fix: Add server-side ballot revocation, checked on every ballot read and write, and revoke the current ballot credential during sign-out. Cover replay of a copied cookie after logout in regression tests. This limitation is documented in API.md, but remains a credential-revocation weakness.

3. [SHOULD] Per-email throttling can be exceeded by concurrent requests.
Evidence: apps/pulse/src/identity/claim.ts:161; apps/pulse/src/identity/claim.ts:175; apps/pulse/src/identity/pg-store.ts:153; apps/pulse/src/http/server.ts:193.
Scenario: Several requests for one address concurrently read fewer than three outstanding links before any inserts commit. Each then inserts and sends another link, exceeding the advertised per-email cap. Multiple source IPs increase the burst; multiple API replicas also multiply the separate in-memory IP allowance.
Fix: Atomically enforce the email quota under a database lock or equivalent shared limiter. Use shared IP limiting before running multiple API replicas. Avoid holding a database transaction open while sending mail.

4. [SHOULD] Thirty-day sessions have no idle timeout or privileged-action reauthentication.
Evidence: apps/pulse/src/http/session.ts:21; apps/pulse/src/http/session.ts:119; apps/pulse/src/authoring/pg-store.ts:219.
Scenario: A stolen account-session cookie remains usable after prolonged inactivity until absolute expiry or explicit revocation. For the owner account, it also authorizes posting-permission changes throughout that period.
Fix: Enforce an idle timeout and require recent authentication for owner permission changes. Choose and document suitable absolute and idle lifetimes.

5. [SHOULD] Cookie names permit sibling-domain cookie injection.
Evidence: apps/pulse/src/http/session.ts:18; apps/pulse/src/http/server.ts:57; apps/pulse/src/http/server.ts:300; apps/pulse/src/http/server.ts:474.
Scenario: If an attacker controls an HTTPS sibling subdomain beneath the deployment’s parent domain, they can plant parent-domain cookies named pulse_session or pulse_ballot containing valid credentials they obtained themselves. Where that cookie is selected, the victim can operate under an attacker-controlled account or ballot. Host-only issuance does not prevent a sibling from injecting competing Domain cookies.
Fix: Use __Host-pulse_session and __Host-pulse_ballot, retaining Secure, Path=/ and no Domain attribute. Retire the old cookie names.

6. [SHOULD] Origin enforcement does not cover every mutation route.
Evidence: apps/pulse/src/http/server.ts:606; apps/pulse/src/http/server.ts:674.
Scenario: POST /api/polls/:id/votes and POST /api/polls/:id/suggestions accept valid JSON with a missing or foreign Origin and mutate state. Voting can also consume account and ballot cookies.
Fix: Apply the shared Origin guard to both routes and explicitly require application/json.
Qualification: Conventional cross-site browser exploitation is UNVERIFIED. The current JSON body requirements and absence of CORS constrain ordinary browser attacks; this is not a demonstrated bypass of those protections.

7. [SHOULD] UNVERIFIED: nginx error logs may retain live token URLs.
Evidence: apps/pulse-web/nginx.conf:17; apps/pulse-web/nginx.conf:27; apps/pulse-web/nginx.conf:57.
Scenario to confirm: An API upstream failure during GET /api/sign-in/redeem?token=… may make nginx’s inherited error logger record the original request, including the live token. The custom access-log format does not sanitize error logs. Someone reading that log could redeem the token.
Fix: Verify effective nginx error logging with a synthetic token and forced upstream failure; ensure credentials cannot reach that sink. Removing token-bearing query requests would reduce exposure. If confirmed, treat this as blocking.

Railway-specific:

- Expose only pulse-web publicly; keep the API private. Configure the nginx upstream to Railway’s actual private API hostname. The shipped configuration requires api:8080 in both proxy locations: apps/pulse-web/nginx.conf:57 and :80.
- Set PULSE_WEB_ORIGIN to the exact public HTTPS origin, without a trailing slash. The validator also accepts HTTP, so HTTPS depends on operator configuration: apps/pulse/src/main.ts:227.
- Set PULSE_TRUSTED_PROXY_HOPS=2 only if the actual chain is Railway edge → nginx → API and both proxy addresses pass the private-address check at apps/pulse/src/http/server.ts:65. Public proxy addresses stop traversal; extra hops alone cannot fix that.
- Before admitting users, verify distinct client rate-limit buckets and resistance to forged X-Forwarded-For. Railway’s actual forwarding behavior is UNVERIFIED here.
- Secure cookies work despite internal HTTP: production explicitly sets Secure and does not condition it on request.protocol, at apps/pulse/src/http/server.ts:480.
- nginx overwrites X-Forwarded-Proto with its internal $scheme, therefore “http” behind Railway TLS: apps/pulse-web/nginx.conf:68 and :86. Preserve the edge’s scheme only through a verified trusted-proxy configuration. Current cookie issuance does not depend on it.
- Enforce public HTTP→HTTPS redirects and HSTS at the TLS edge, including API/error responses, as required by apps/pulse/DEPLOY.md:40.
- Supply independent, randomly generated, persistent PULSE_SESSION_SECRET and PULSE_CONFIRMATION_KEY values; each must contain at least 32 characters. Keep them in Railway secrets alongside PULSE_RESEND_API_KEY and PULSE_DATABASE_URL.
- Configure PULSE_MAIL_FROM on a verified sending domain. Set PULSE_OWNER_EMAIL only to a mailbox the operator controls; protect that mailbox strongly.
- Keep one API replica for the pilot unless rate limiting becomes shared. Verify database transport protection and restrict access to backups.

Checked and fine:

Magic-link cryptography: randomBytes(32) provides 256-bit tokens; SHA-256 digests are stored, with a 15-minute lifetime: apps/pulse/src/identity/claim.ts:61, :111, :167 and :356.

Replay and races: redemption atomically deletes an unexpired pending claim and inserts a hash-only replay marker; competing first registrations resolve through credential uniqueness: apps/pulse/src/identity/pg-store.ts:195; apps/pulse/src/identity/claim.ts:303. Tests describe both races at apps/pulse/test/claim.test.ts:87 and :104; they were inspected, not run.

Token comparison: authentication performs an exact lookup of the complete SHA-256 digest, rather than a raw-token prefix comparison: apps/pulse/src/identity/pg-store.ts:178. No exploitable character-by-character comparison was identified.

Email binding and enumeration: claims retain the normalized requesting email; link requests do not branch on whether an account exists. The per-email-cap response exposes outstanding-link activity, not registration status: apps/pulse/src/identity/claim.ts:128 and :282.

Mail injection and redirects: email validation rejects internal header-control characters; Resend receives structured JSON and escaped HTML. Links use trusted configuration and encoded tokens, not request Host or a caller-supplied destination: apps/pulse/src/identity/email.ts:35; apps/pulse/src/identity/resend-mailer.ts:104; apps/pulse/src/main.ts:363.

Session integrity: HMAC-SHA256, timingSafeEqual, server-enforced expiry, and generation checks are present. Successful sign-in replaces the session cookie; session and ballot formats cannot substitute for one another: apps/pulse/src/http/session.ts:135; apps/pulse/src/http/server.ts:241, :280 and :474.

Account-session revocation: sign-out atomically increments shared session_generation; migration 003 introduces the counter. Old-generation cookies are rejected across instances: apps/pulse/src/identity/pg-store.ts:127; apps/pulse/src/http/server.ts:247.

Cookie flags: both cookies use HttpOnly, Secure, SameSite=Lax, Path=/ and omit Domain: apps/pulse/src/http/server.ts:300 and :474. Prefix and lifetime weaknesses are listed above.

CSRF coverage that passes: sign-in, redeem and sign-out check exact configured Origin; publication, permission changes, uploads, profile writes and all contribution writes also check it: apps/pulse/src/http/server.ts:312; apps/pulse/src/http/creation.ts:188; apps/pulse/src/http/images.ts:170; apps/pulse/src/http/profiles.ts:177; apps/pulse/src/http/contributions.ts:109.

Secrets: production refuses missing required credentials, short application secrets and identical session/confirmation keys; it does not fall back to ConsoleMailer: apps/pulse/src/main.ts:130, :175 and :183.

Confirmation codes: domain-separated HMAC-SHA256 uses unambiguous inputs. Database plus confirmation-key compromise can identify confirmed voters’ answers; this is explicitly acknowledged, not encryption: apps/pulse/src/voting/confirmation.ts:24 and :61.

Application logging/errors: request logs strip queries; fault logs allow-list metadata; unexpected errors return generic bodies. Provider response text is discarded: apps/pulse/src/main.ts:297; apps/pulse/src/logging.ts:22; apps/pulse/src/http/server.ts:225; apps/pulse/src/identity/resend-mailer.ts:215. nginx error logging remains unresolved above.

Referrers and URL cleanup: the page sets no-referrer before scripts load; successful redemption replaces the token-bearing history entry. Failed redemption leaves the token in the URL: apps/pulse-web/index.html:6; apps/pulse-web/src/App.tsx:181; apps/pulse-web/src/hooks/use-route.ts:44.

Owner authorization: privileges require a stored email credential matching trusted configuration, with transaction-level session-generation rechecks. Client fields cannot grant ownership: apps/pulse/src/authoring/owner.ts:13; apps/pulse/src/authoring/pg-store.ts:231 and :284.

MCP: only public reads exist; browser credentials are not forwarded upstream; destinations are fixed and redirects refused. DELETE performs no mutation: apps/pulse/src/http/mcp/route.ts:133 and :138; apps/pulse/src/http/mcp/client.ts:169.

Not checked:

No tests, package commands, network calls or database commands were run; no files were changed. Findings are source-derived, with runtime uncertainties explicitly marked.

Railway configuration, live headers, proxy addressing, nginx inherited configuration, TLS, DNS/mail delivery, secret values/entropy, database grants and backups were not inspected.

Current OWASP ASVS v4/v5 text and cheat-sheet revisions were not fetched because network access was prohibited. This is an assessment against established authentication/session principles, not a complete ASVS compliance certification or dependency-vulnerability audit.```
