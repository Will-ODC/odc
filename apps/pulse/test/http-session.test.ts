import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { createServer, type ServerDeps } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const SECRET = "test-secret-that-is-long-enough";
const START = new Date("2026-08-09T12:00:00.000Z");

async function setup(
  overrides: Partial<ServerDeps> = {},
  omitSecureFlag = false,
) {
  let now = START;
  const clock = () => now;
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
  const signer = new SessionSigner(SECRET, { ttlSeconds: 3600, clock });

  const claims = new ClaimService(
    {
      membership: new DomainAllowlist(
        new StaticDomainSource([
          { community: "ubc-students", domain: "student.ubc.ca" },
        ]),
      ),
      voters,
      claims: new InMemoryClaimStore(),
      mailer,
      linkFor: (token) => `https://pulse.test/claim?token=${token}`,
    },
    { clock },
  );

  const app = await createServer({
    claims,
    voters,
    votes: new InMemoryVotingStore(clock),
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    // Omitted in the one test that pins the safe default.
    ...(omitSecureFlag ? {} : { secureCookies: false }),
    ...overrides,
  });

  return {
    app,
    voters,
    signer,
    after(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
    afterMs(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    /** The Set-Cookie the redeem sets, with its attributes intact. */
    async signOutOfBandCookie(email: string) {
      await app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email },
      });
      const link = mailer.lastTo(email)?.body as string;
      const redeemed = await app.inject({
        method: "POST",
        url: "/api/sign-in/redeem",
        payload: { token: new URL(link).searchParams.get("token") },
      });
      const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
      assert.ok(cookie, "no session cookie was set");
      return cookie;
    },
    async signIn(email: string): Promise<string> {
      await app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email },
      });
      const link = mailer.lastTo(email)?.body as string;
      const token = new URL(link).searchParams.get("token");
      const redeemed = await app.inject({
        method: "POST",
        url: "/api/sign-in/redeem",
        payload: { token },
      });
      const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
      assert.ok(cookie, "no session cookie was set");
      return `${SESSION_COOKIE}=${cookie.value}`;
    },
  };
}

test("a_signed_in_voter_can_read_who_they_are", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  const me = await h.app.inject({ url: "/api/me", headers: { cookie } });

  assert.equal(me.statusCode, 200);
  assert.equal(me.json().voter.email, "ada@student.ubc.ca");
  assert.equal(me.json().voter.community, "ubc-students");
});

test("signing_out_kills_a_cookie_someone_else_kept_a_copy_of", async () => {
  // The defect the old suite could not see: it asserted /api/me with NO cookie
  // was 401, which passes whether or not sign-out does anything at all. The
  // cookie has to be replayed.
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    200,
  );

  h.after(1);
  const out = await h.app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie },
  });
  assert.equal(out.statusCode, 200);
  assert.equal(out.cookies.find((c) => c.name === SESSION_COOKIE)?.value, "");

  const replayed = await h.app.inject({ url: "/api/me", headers: { cookie } });
  assert.equal(replayed.statusCode, 401, "the old cookie still works");
});

test("signing_out_does_not_sign_anyone_else_out", async () => {
  const h = await setup();
  const ada = await h.signIn("ada@student.ubc.ca");
  const sam = await h.signIn("sam@student.ubc.ca");

  h.after(1);
  await h.app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie: ada },
  });

  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie: sam } }))
      .statusCode,
    200,
  );
});

test("signing_in_again_after_signing_out_works", async () => {
  // The cut-off must not lock someone out of their own account.
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  h.after(1);
  await h.app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie },
  });

  h.after(1);
  const fresh = await h.signIn("ada@student.ubc.ca");
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie: fresh } }))
      .statusCode,
    200,
  );
});

test("signing_back_in_within_the_same_second_works", async () => {
  // The case the test above cannot see: it advances a whole second, so a cookie
  // stamped only to the second still lands after the sign-out. Someone who
  // signs out and immediately clicks a fresh link stays inside one second, and
  // used to be handed a cookie their own sign-out had already invalidated.
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");

  h.afterMs(400);
  await h.app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie },
  });

  h.afterMs(200);
  const fresh = await h.signIn("ada@student.ubc.ca");
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie: fresh } }))
      .statusCode,
    200,
    "the cookie issued after signing out was refused",
  );
});

test("signing_out_while_signed_out_is_harmless", async () => {
  const h = await setup();
  const out = await h.app.inject({ method: "POST", url: "/api/sign-out" });
  assert.equal(out.statusCode, 200);
});

test("an_expired_cookie_is_signed_out", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");

  h.after(3599);
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    200,
  );
  h.after(2);
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    401,
  );
});

test("a_validly_signed_cookie_for_a_voter_who_does_not_exist_is_signed_out", async () => {
  // Signature valid, voter absent. Only the existence check stands between
  // this cookie and a session.
  const h = await setup();
  const cookie = `${SESSION_COOKIE}=${h.signer.sign("no-such-voter")}`;
  assert.equal(
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    401,
  );
});

test("forged_and_foreign_cookies_are_signed_out", async () => {
  const h = await setup();
  const real = await h.signIn("ada@student.ubc.ca");
  const value = real.slice(SESSION_COOKIE.length + 1);
  const [voterId, iat, exp, mac] = value.split(".");
  const other = new SessionSigner("a-completely-different-secret");

  for (const forged of [
    `${SESSION_COOKIE}=${voterId}.${iat}.${exp}.not-a-signature`,
    `${SESSION_COOKIE}=${voterId}.${iat}.${exp}`,
    `${SESSION_COOKIE}=someone-else.${iat}.${exp}.${mac}`,
    `${SESSION_COOKIE}=${voterId}.${iat}.${Number(exp) + 86_400}.${mac}`,
    `${SESSION_COOKIE}=${other.sign(voterId as string)}`,
    `${SESSION_COOKIE}=`,
  ]) {
    const me = await h.app.inject({
      url: "/api/me",
      headers: { cookie: forged },
    });
    assert.equal(me.statusCode, 401, `accepted a forged cookie: ${forged}`);
  }
});

test("the_session_cookie_is_http_only_same_site_and_secure_by_default", async () => {
  // Every other test passes secureCookies:false, so without this case the safe
  // default is the one thing nothing pins.
  const h = await setup({}, true);
  const cookie = await h.signOutOfBandCookie("ada@student.ubc.ca");

  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/");
  assert.equal(cookie.maxAge, 3600);
});

test("no_response_mentions_hashes_chains_or_how_anything_is_counted", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  const bodies = [
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).body,
    (await h.app.inject({ url: "/api/me" })).body,
    (await h.app.inject({ method: "POST", url: "/api/sign-out" })).body,
  ].join(" ");

  for (const word of ["hash", "chain", "tally", "tabulat", "ledger", "verif"]) {
    assert.equal(
      bodies.toLowerCase().includes(word),
      false,
      `response mentions "${word}"`,
    );
  }
});
