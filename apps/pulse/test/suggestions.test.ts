import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySuggestionStore,
  keywords,
  overlap,
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

// The in-memory suggestion store, held to the suite every implementation runs.
suggestionStoreConformance(
  "in memory",
  async (clock) => new InMemorySuggestionStore({ clock }),
);
