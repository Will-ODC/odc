import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicProfileId, normalizeProfile } from "../src/profiles/input.js";

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

test("public_profile_ids_are_canonical_random_uuid_shapes", () => {
  assert.equal(isPublicProfileId("f8cdca64-0d4f-4b99-b5bc-e6b749843ad8"), true);
  assert.equal(isPublicProfileId("internal-voter-id"), false);
  assert.equal(
    isPublicProfileId("f8cdca64-0d4f-0b99-75bc-e6b749843ad8"),
    false,
  );
});
