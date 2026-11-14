import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeCreation,
  requestKey,
  PURPOSE_VERSION,
} from "../src/authoring/input.js";
const body = { question: " Q ", choices: [" A ", " B "], method: "single" };
test("context_is_trimmed_plain_text_with_normalized_newlines_and_a_code_point_limit", () => {
  for (const [input, context] of [
    [
      "  First line\r\n<b>literal text</b> 🌱  ",
      "First line\n<b>literal text</b> 🌱",
    ],
    ["🌱".repeat(500), "🌱".repeat(500)],
  ]) {
    assert.deepEqual(normalizeCreation({ ...body, context: input }), {
      ...normalizeCreation(body),
      context,
    });
  }
});

test("absent_or_blank_context_preserves_the_legacy_canonical_input", () => {
  for (const context of ["", "  \n  ", "\u00a0"]) {
    assert.deepEqual(
      normalizeCreation({ ...body, context }),
      normalizeCreation(body),
    );
  }
});

test("context_refuses_invalid_types_overlength_and_unpaired_surrogates", () => {
  for (const context of [
    null,
    1,
    {},
    [],
    "a".repeat(501),
    "🌱".repeat(501),
    "bad\ud800",
    "bad\udfff",
  ]) {
    assert.throws(() => normalizeCreation({ ...body, context }), {
      message: "bad_request",
    });
  }
});

test("context_refuses_every_control_except_LF_even_before_trimming", () => {
  for (let point = 0; point <= 159; point += 1) {
    if (point === 10 || (point > 31 && point < 127)) continue;
    for (const context of [
      `${String.fromCodePoint(point)}text`,
      `text${String.fromCodePoint(point)}`,
    ]) {
      assert.throws(() => normalizeCreation({ ...body, context }), {
        message: "bad_request",
      });
    }
  }
});
test("normalization_preserves_omitted_close_time_for_later_replays", () => {
  assert.deepEqual(normalizeCreation(body), {
    question: "Q",
    choices: ["A", "B"],
    method: "single",
    attribution: { kind: "anonymous" },
    closesAt: null,
    purposeAcknowledgement: null,
  });
  assert.deepEqual(
    normalizeCreation({
      ...body,
      attribution: { kind: "named", name: " Ada " },
      purposeAcknowledgement: PURPOSE_VERSION,
    }).attribution,
    { kind: "named", name: "Ada" },
  );
});
for (const [index, patch] of [
  { createdBy: "owner" },
  { community: "campus" },
  { acceptsSuggestions: true },
  { choices: ["A", "A "] },
  { choices: ["A"] },
  { choices: Array.from({ length: 26 }, (_, i) => String(i)) },
  { method: "unknown" },
  { question: " " },
  { question: "a".repeat(1001) },
  { attribution: { kind: "anonymous", name: "Ada" } },
  { attribution: { kind: "named", name: " " } },
  { attribution: { kind: "named", name: "a".repeat(81) } },
  { attribution: null },
  { purposeAcknowledgement: "v2" },
  { closesAt: null },
  { closesAt: "2026-02-30T00:00:00.000Z" },
  { closesAt: "2026-10-12" },
].entries())
  test(`refuses_${["author_override", "community_override", "suggestions_override", "duplicate_choices", "too_few_choices", "too_many_choices", "unknown_method", "blank_question", "overlong_question", "anonymous_name", "blank_name", "overlong_name", "null_attribution", "unknown_promise", "null_close", "impossible_date", "non_timestamp_close"][index]}`, () =>
    assert.throws(() => normalizeCreation({ ...body, ...patch }), {
      message: "bad_request",
    }));
test("UUID_keys_are_case_normalized_but_not_trimmed_or_guessed", () => {
  assert.equal(
    requestKey("ABCDEF01-2345-6789-ABCD-EF0123456789"),
    "abcdef01-2345-6789-abcd-ef0123456789",
  );
  assert.throws(() => requestKey("not-a-key"), { message: "bad_request" });
});

for (const [field, patch] of [
  ["question", { question: "Q\u0000" }],
  ["choices", { choices: ["A\ud800", "B"] }],
  ["name", { attribution: { kind: "named", name: "Ada\udfff" } }],
] as const)
  test(`invalid_Unicode_in_${field}_is_bad_request`, () => {
    assert.throws(() => normalizeCreation({ ...body, ...patch }), {
      message: "bad_request",
    });
  });
test("valid_astral_Unicode_is_preserved_in_questions_choices_and_names", () => {
  const result = normalizeCreation({
    ...body,
    question: "Garden 🌱?",
    choices: ["🌱", "🌳"],
    attribution: { kind: "named", name: "Ada 🌞" },
  });
  assert.equal(result.question, "Garden 🌱?");
  assert.deepEqual(result.choices, ["🌱", "🌳"]);
  assert.deepEqual(result.attribution, { kind: "named", name: "Ada 🌞" });
});
