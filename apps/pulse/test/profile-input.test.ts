import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  IGNORED_IN_NAME,
  isPublicProfileId,
  isReservedName,
  normalizeProfile,
} from "../src/profiles/input.js";
import {
  ALLOWED_SPELLINGS,
  RESERVED_SPELLINGS,
} from "./support/reserved-names.js";

test("profile_input_trims_plain_text_and_keeps_an_empty_bio", () => {
  assert.deepEqual(
    normalizeProfile({ displayName: " Ada ", bio: "  ", visible: true }),
    { displayName: "Ada", bio: "", visible: true },
  );
});

test("profile_input_enforces_exact_shape_types_and_code_point_limits", () => {
  for (const body of [
    { displayName: "", bio: "", visible: true },
    { displayName: "a".repeat(81), bio: "", visible: true },
    { displayName: "Ada", bio: "b".repeat(281), visible: true },
    { displayName: "Ada\0", bio: "", visible: true },
    { displayName: "Ada\u0007", bio: "", visible: true },
    { displayName: "Ada\u202e", bio: "", visible: true },
    { displayName: "\u200b\u2066\u2069", bio: "", visible: true },
    { displayName: "\u0301\u0308", bio: "", visible: true },
    { displayName: "Ada", bio: "\ud800", visible: true },
    { displayName: "Ada", bio: "", visible: "yes" },
    { displayName: "Ada", bio: "", visible: true, email: "private@test" },
  ])
    assert.throws(() => normalizeProfile(body), { message: "bad_request" });

  assert.equal(
    normalizeProfile({
      displayName: "😀".repeat(80),
      bio: "😀".repeat(280),
      visible: false,
    }).bio.length,
    560,
  );
});

test("display_names_keep_joiners_beside_visible_text_and_refuse_bidi_controls", () => {
  const name = (displayName: string) =>
    normalizeProfile({ displayName, bio: "", visible: true }).displayName;
  // ZWJ in an emoji sequence, ZWNJ in Persian and in Hindi.
  for (const ok of [
    "\u{1F469}\u200D\u{1F4BB} Ada",
    "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645",
    "\u0915\u094D\u200C\u0937",
    "Zoë",
  ])
    assert.equal(name(ok), ok);
  for (const refused of [
    "\u200D",
    "\u200C\u200D",
    "\u200B",
    "Ada\u202A",
    "Ada\u202E",
    "\u2066Ada\u2069",
    "Ada\u200E",
    "Ada\u00AD",
  ])
    assert.throws(() => name(refused), { message: "bad_request" }, refused);
});

test("public_profile_ids_are_canonical_random_uuid_shapes", () => {
  assert.equal(isPublicProfileId("f8cdca64-0d4f-4b99-b5bc-e6b749843ad8"), true);
  assert.equal(isPublicProfileId("internal-voter-id"), false);
  assert.equal(
    isPublicProfileId("f8cdca64-0d4f-0b99-75bc-e6b749843ad8"),
    false,
  );
});

test("the_reserved_name_is_caught_in_every_spelling_that_reads_the_same", () => {
  for (const name of RESERVED_SPELLINGS)
    assert.equal(isReservedName(name), true, JSON.stringify(name));
  for (const name of ALLOWED_SPELLINGS)
    assert.equal(isReservedName(name), false, JSON.stringify(name));
});

test("migration_019_drops_nothing_the_app_check_keeps", async () => {
  // PostgreSQL has no Unicode categories, so 019 spells the dropped set out
  // as ranges. Every code point in them must be dropped by the app check
  // too, so the database never refuses a name the app allows (a 500).
  const ignored = new RegExp(IGNORED_IN_NAME.source, "u");
  const ranges = await migration019Ranges();
  assert.ok(ranges.length > 400);
  for (const [from, to] of ranges)
    for (let c = from; c <= to; c++)
      assert.ok(ignored.test(String.fromCodePoint(c)), c.toString(16));
});

/** The code point ranges of 019's bracket expression. */
async function migration019Ranges(): Promise<[number, number][]> {
  const sql = await readFile(
    new URL(
      "../../migrations/019_reserved_name_invisibles.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = sql.slice(sql.indexOf("'[' ||"), sql.indexOf("|| ']'"));
  const literal = [...body.matchAll(/'([^']*)'/g)]
    .map((m) => m[1])
    .slice(1)
    .join("");
  const one = String.raw`\\(?:u([0-9A-F]{4})|U([0-9A-F]{8}))`;
  const range = new RegExp(`${one}(?:-${one})?`, "g");
  const ranges: [number, number][] = [];
  let consumed = 0;
  for (const m of literal.matchAll(range)) {
    assert.equal(m.index, consumed, "019's class is only escapes and ranges");
    consumed += m[0].length;
    const from = parseInt(m[1] ?? m[2]!, 16);
    const toHex = m[3] ?? m[4];
    ranges.push([from, toHex === undefined ? from : parseInt(toHex, 16)]);
  }
  assert.equal(consumed, literal.length);
  return ranges;
}
