import assert from "node:assert/strict";
import test from "node:test";
import { createPoll } from "../src/voting/poll.js";
import {
  InMemorySuggestionStore,
  decide,
  keywords,
  overlap,
  type Suggestion,
} from "../src/voting/suggestions.js";
import { suggestionStoreConformance } from "./conformance/suggestion-store.js";

test("keywords keeps what a phrase is about and drops what every phrase has", () => {
  assert.deepEqual(
    [...keywords("We should charge the members a fee")],
    ["charge", "members", "fee"],
  );
});

test("keywords ignores punctuation, case and apostrophes", () => {
  assert.deepEqual([...keywords("Members' FEES!")], ["members", "fees"]);
});

test("overlap calls the same idea in different words the same idea", () => {
  assert.ok(overlap("charge the members", "we could charge members") >= 0.6);
});

test("overlap keeps different proposals apart", () => {
  assert.ok(overlap("charge the members", "apply for grants") < 0.3);
});

test("a phrase of nothing but filler matches nothing, rather than everything", () => {
  // Both sides reduce to no keywords. Calling that a perfect match would file
  // every empty phrase under whichever one was submitted first.
  assert.equal(overlap("should we do it", "can you get that"), 0);
});

// `decide` is what every store answers with, so what it says about `related`
// is part of the contract, not a detail of one store.

const ON = new Date("2026-08-24T00:00:00.000Z");
const withGrants = createPoll(
  {
    id: "p1",
    question: "How do we pay for it?",
    choices: ["Yes", "No", "Grants"],
    method: "single",
    acceptsSuggestions: true,
  },
  ON,
);
const said = (text: string): Suggestion => ({
  id: text,
  pollId: "p1",
  text,
  count: 1,
  addedAt: ON,
});

test("a seconded suggestion is not listed as related to itself", () => {
  const decision = decide(withGrants, "we could charge members", [
    said("Charge the members"),
  ]);
  assert.equal(decision.kind, "second");
  assert.deepEqual(decision.related, []);
});

test("pointing at the ballot still shows the suggestions near it", () => {
  const decision = decide(withGrants, "Grants", [
    said("Grants from the council"),
  ]);
  assert.equal(decision.kind, "on_ballot");
  assert.deepEqual(
    decision.related.map((s) => s.text),
    ["Grants from the council"],
  );
});

// The in-memory suggestion store, held to the suite every implementation runs.
suggestionStoreConformance(
  "in memory",
  async (clock) => new InMemorySuggestionStore({ clock }),
);
