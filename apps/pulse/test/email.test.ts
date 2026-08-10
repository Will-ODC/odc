import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidEmailError,
  isValidEmail,
  parseEmail,
} from "../src/identity/email.js";

test("parses_a_plain_address_into_value_and_domain", () => {
  const email = parseEmail("Ada.Lovelace@student.ubc.ca");
  assert.equal(email.value, "ada.lovelace@student.ubc.ca");
  assert.equal(email.domain, "student.ubc.ca");
});

test("normalizes_case_and_surrounding_whitespace", () => {
  // Two spellings of one person must land on one stored address, or the
  // one-claim-per-person rule quietly stops holding.
  assert.equal(
    parseEmail("  ADA@UBC.CA  ").value,
    parseEmail("ada@ubc.ca").value,
  );
});

test("keeps_plus_addressing_distinct", () => {
  // Deliberate: `a+one@` and `a+two@` are different addresses here. Collapsing
  // them is a policy decision about who counts as one person, and it is not
  // this function's to make.
  assert.notEqual(
    parseEmail("a+one@ubc.ca").value,
    parseEmail("a+two@ubc.ca").value,
  );
});

test("rejects_addresses_with_no_usable_shape", () => {
  for (const bad of [
    "",
    "   ",
    "ada",
    "ada@",
    "@ubc.ca",
    "ada@@ubc.ca",
    "ada ada@ubc.ca",
  ]) {
    assert.throws(
      () => parseEmail(bad),
      InvalidEmailError,
      `expected rejection: ${bad}`,
    );
  }
});

test("rejects_a_domain_without_a_dot_or_with_empty_parts", () => {
  assert.throws(() => parseEmail("ada@localhost"), InvalidEmailError);
  assert.throws(() => parseEmail("ada@ubc..ca"), InvalidEmailError);
  assert.throws(() => parseEmail("ada@.ubc.ca"), InvalidEmailError);
  assert.throws(() => parseEmail("ada@ubc.ca."), InvalidEmailError);
});

test("rejects_a_domain_that_is_an_address_literal", () => {
  assert.throws(() => parseEmail("ada@127.0.0.1"), InvalidEmailError);
});

test("rejects_hyphens_at_the_edges_of_a_domain_part", () => {
  assert.throws(() => parseEmail("ada@-ubc.ca"), InvalidEmailError);
  assert.throws(() => parseEmail("ada@ubc-.ca"), InvalidEmailError);
  assert.doesNotThrow(() => parseEmail("ada@my-school.ubc.ca"));
});

test("rejects_addresses_over_the_length_limits", () => {
  assert.throws(
    () => parseEmail(`${"a".repeat(65)}@ubc.ca`),
    InvalidEmailError,
  );
  assert.throws(
    () => parseEmail(`${"a".repeat(60)}@${"b".repeat(200)}.ca`),
    InvalidEmailError,
  );
  assert.throws(
    () => parseEmail(`ada@${"b".repeat(64)}.ca`),
    InvalidEmailError,
  );
});

test("the_error_names_the_address_and_the_reason", () => {
  try {
    parseEmail("ada@localhost");
    assert.fail("expected a rejection");
  } catch (err) {
    assert.ok(err instanceof InvalidEmailError);
    assert.match(err.message, /ada@localhost/);
    assert.match(err.message, /dot/);
  }
});

test("is_valid_email_answers_without_throwing", () => {
  assert.equal(isValidEmail("ada@student.ubc.ca"), true);
  assert.equal(isValidEmail("nope"), false);
});
