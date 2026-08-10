import assert from "node:assert/strict";
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

test("non_numeric_timestamps_do_not_verify_even_when_signed", () => {
  // A correctly signed cookie must still be rejected if its timestamps are not
  // timestamps — otherwise NaN comparisons decide whether someone is signed in.
  const { signer } = signerAt();
  const forged = new SessionSigner(SECRET, { clock: () => START });
  const payload = "voter-1.not-a-number.also-not";
  const signed = forged.sign("voter-1");
  const mac = signed.slice(signed.lastIndexOf(".") + 1);
  assert.equal(signer.verify(`${payload}.${mac}`), undefined);
});

test("a_short_secret_is_refused_outright", () => {
  assert.throws(() => new SessionSigner("too-short"), /at least 16/);
});
