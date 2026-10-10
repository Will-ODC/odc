import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSURANCE_LEVELS,
  assuranceOf,
  compareAssurance,
  meetsAssurance,
  parseAssurance,
} from "../src/identity/assurance.js";

test("the_levels_run_none_then_link_then_email", () => {
  // Decided 2026-09-12 (P8 decision 1). The order lives here and nowhere
  // else — the database stores only the words.
  assert.deepEqual(ASSURANCE_LEVELS, ["none", "link", "email"]);
  assert.ok(compareAssurance("none", "link") < 0);
  assert.ok(compareAssurance("link", "email") < 0);
  assert.equal(compareAssurance("email", "email"), 0);
  assert.ok(compareAssurance("email", "none") > 0);
});

test("a_level_meets_itself_and_everything_below_it_only", () => {
  assert.equal(meetsAssurance("email", "link"), true);
  assert.equal(meetsAssurance("link", "link"), true);
  assert.equal(meetsAssurance("link", "email"), false);
  assert.equal(meetsAssurance("none", "link"), false);
});

test("a_stored_word_is_read_back_only_if_this_build_knows_it", () => {
  assert.equal(parseAssurance("link"), "link");
  // Neither demoted to `none` nor promoted: refused.
  assert.throws(() => parseAssurance("in_person"), /unknown assurance level/);
  assert.throws(() => parseAssurance("Email"), /unknown assurance level/);
});

test("an_email_credential_confers_email_assurance", () => {
  assert.equal(assuranceOf("email"), "email");
});
