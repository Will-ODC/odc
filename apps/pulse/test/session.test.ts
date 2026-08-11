import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { SessionSigner } from "../src/http/session.js";

const SECRET = "test-secret-that-is-long-enough";
const START = new Date("2026-08-09T12:00:00.000Z");

function signerAt(start = START, ttlSeconds = 3600) {
  let now = start;
  return {
    signer: new SessionSigner(SECRET, { ttlSeconds, clock: () => now }),
    after(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

test("a_freshly_signed_cookie_verifies_and_names_its_voter", () => {
  const { signer } = signerAt();
  const claims = signer.verify(signer.sign("voter-1"));
  assert.equal(claims?.voterId, "voter-1");
  assert.equal(claims?.issuedAt.getTime(), START.getTime());
  assert.equal(claims?.expiresAt.getTime(), START.getTime() + 3600_000);
});

test("a_cookie_stops_verifying_once_it_expires", () => {
  // The whole point of the rewrite: expiry is checked by the server, not left
  // to a Set-Cookie attribute the browser may ignore or a copy may never see.
  const h = signerAt(START, 60);
  const cookie = h.signer.sign("voter-1");

  h.after(59);
  assert.ok(h.signer.verify(cookie));
  h.after(2);
  assert.equal(h.signer.verify(cookie), undefined);
});

test("a_tampered_expiry_does_not_verify", () => {
  // Otherwise the expiry would be advice rather than a rule.
  const { signer } = signerAt(START, 60);
  const cookie = signer.sign("voter-1");
  const [voterId, iat, exp, mac] = cookie.split(".");
  assert.ok(exp);

  const extended = `${voterId}.${iat}.${Number(exp) + 86_400}.${mac}`;
  assert.equal(signer.verify(extended), undefined);
});

test("a_tampered_voter_id_or_signature_does_not_verify", () => {
  const { signer } = signerAt();
  const cookie = signer.sign("voter-1");
  const [, iat, exp, mac] = cookie.split(".");

  assert.equal(signer.verify(`voter-2.${iat}.${exp}.${mac}`), undefined);
  assert.equal(
    signer.verify(`voter-1.${iat}.${exp}.not-a-signature`),
    undefined,
  );
  assert.equal(signer.verify(`voter-1.${iat}.${exp}`), undefined);
  assert.equal(signer.verify("voter-1"), undefined);
  assert.equal(signer.verify(""), undefined);
  assert.equal(signer.verify(undefined), undefined);
});

test("a_cookie_from_another_secret_does_not_verify", () => {
  const { signer } = signerAt();
  const other = new SessionSigner("a-completely-different-secret");
  assert.equal(signer.verify(other.sign("voter-1")), undefined);
});

test("a_voter_id_containing_dots_survives_the_round_trip", () => {
  // The cookie is dot-separated, so an id with dots is the case most likely to
  // be parsed back wrongly.
  const { signer } = signerAt();
  for (const id of ["a.b.c", ".leading", "trailing.", "1.2.3.4"]) {
    assert.equal(
      signer.verify(signer.sign(id))?.voterId,
      id,
      `round trip failed for ${id}`,
    );
  }
});

test("a_genuinely_signed_cookie_with_unusable_fields_still_does_not_verify", () => {
  // The MAC is computed over the malformed payload itself, so verification
  // reaches the field checks instead of stopping at the signature. The earlier
  // version of this test signed one payload and presented another, which meant
  // the guards below were held in place by nothing.
  const { signer } = signerAt();
  const sign = (payload: string) =>
    `${payload}.${createHmac("sha256", SECRET).update(payload, "utf8").digest("base64url")}`;

  for (const payload of [
    "voter-1.not-a-number.also-not",
    "voter-1.1754740800.not-a-number",
    "voter-1..1754744400",
    ".1754740800.1754744400", // no voter id
    "voter-1.1.5.1754744400", // fractional
    `voter-1.1754740800.${Number.MAX_SAFE_INTEGER + 2}`, // beyond safe integers
  ]) {
    assert.equal(
      signer.verify(sign(payload)),
      undefined,
      `accepted a signed but unusable cookie: ${payload}`,
    );
  }
});

test("the_issue_time_keeps_its_milliseconds", () => {
  // Rounding iat down to its second puts a freshly issued cookie *behind* a
  // sign-out that happened earlier in the same second, which locks the voter
  // out of the session they just created.
  const start = new Date("2026-08-09T12:00:00.600Z");
  const { signer } = signerAt(start);
  const claims = signer.verify(signer.sign("voter-1"));
  assert.equal(claims?.issuedAt.getTime(), start.getTime());
});

test("two_cookies_issued_in_the_same_second_are_ordered", () => {
  const h = signerAt(new Date("2026-08-09T12:00:00.100Z"));
  const first = h.signer.verify(h.signer.sign("voter-1"));
  h.after(0.3);
  const second = h.signer.verify(h.signer.sign("voter-1"));

  assert.ok(first && second);
  assert.ok(
    first.issuedAt.getTime() < second.issuedAt.getTime(),
    "the two issue times collapsed onto the same instant",
  );
});

test("a_signed_cookie_with_no_timestamps_at_all_does_not_verify", () => {
  // Pins the structural parse: without it these reach Number() and NaN decides.
  const { signer } = signerAt();
  const sign = (payload: string) =>
    `${payload}.${createHmac("sha256", SECRET).update(payload, "utf8").digest("base64url")}`;

  assert.equal(signer.verify(sign("voter-1")), undefined);
  assert.equal(signer.verify(sign("")), undefined);
});

test("a_short_secret_is_refused_outright", () => {
  assert.throws(() => new SessionSigner("too-short"), /at least 16/);
});
