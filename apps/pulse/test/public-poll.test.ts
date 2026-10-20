import assert from "node:assert/strict";
import { test } from "node:test";
import { createPoll, type Publication } from "../src/voting/poll.js";
import { publicPoll } from "../src/voting/public-poll.js";

const AT = new Date("2026-10-20T12:00:00.000Z");
const poll = createPoll(
  { id: "p", question: "Q", choices: ["A", "B"], method: "single" },
  AT,
);

test("a_poll_without_a_publication_has_exactly_the_original_public_keys", () => {
  assert.deepEqual(Object.keys(publicPoll(poll, AT)), [
    "id",
    "question",
    "choices",
    "method",
    "next",
    "acceptsSuggestions",
    "closesAt",
    "open",
  ]);
});

test("an_unknown_attribution_kind_is_refused_not_published_as_anonymous", () => {
  const publication = {
    community: { id: "pulse-general", label: "General" },
    attribution: { kind: "verified", accountId: "author-account" },
  } as unknown as Publication;
  assert.throws(() => publicPoll({ ...poll, publication }, AT), TypeError);
});

test("the_projection_shares_no_mutable_state_with_the_stored_poll", () => {
  const publication: Publication = {
    community: { id: "campus", label: "Campus" },
    attribution: { kind: "named", name: "Ada" },
  };
  const read = publicPoll({ ...poll, publication }, AT);
  read.community!.label = "changed";
  read.choices.push("C");
  assert.equal(publication.community.label, "Campus");
  assert.deepEqual(poll.choices, ["A", "B"]);
});
