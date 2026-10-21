import { describe, expect, it } from "vitest";
import {
  DRAFT_LIFETIME_MS,
  forgetDraft,
  keepDraft,
  readDraft,
} from "../src/flow/draft-store.js";
import { emptyDraft } from "../src/flow/new-poll.js";
import type { ReturnStore } from "../src/flow/sign-in-return.js";

function memory(): ReturnStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const DRAFT = {
  ...emptyDraft(),
  question: "Open a garden?",
  choices: ["Yes", "No"],
  attribution: { kind: "named" as const, name: "Ada" },
};

describe("a draft kept across sign-in", () => {
  it("comes back as written until forgotten", () => {
    const store = memory();
    keepDraft(DRAFT, store, 0);
    expect(readDraft(store, 1)).toEqual(DRAFT);
    forgetDraft(store);
    expect(readDraft(store, 2)).toBeNull();
  });

  /* #393 review: on a shared device the next person makes the promise. */
  it("never brings back a ticked promise, kept or written by hand", () => {
    const store = memory();
    keepDraft({ ...DRAFT, promised: true }, store, 0);
    expect(readDraft(store, 1)?.promised).toBe(false);
    expect(store.getItem("pulse.newPollDraft")).not.toContain(
      '"promised":true',
    );
    store.setItem(
      "pulse.newPollDraft",
      JSON.stringify({ draft: { ...DRAFT, promised: true }, at: 0 }),
    );
    expect(readDraft(store, 1)?.promised).toBe(false);
  });

  it("is ignored after an hour", () => {
    const store = memory();
    keepDraft(DRAFT, store, 0);
    expect(readDraft(store, DRAFT_LIFETIME_MS)).toEqual(DRAFT);
    expect(readDraft(store, DRAFT_LIFETIME_MS + 1)).toBeNull();
  });

  it("drops anything this file did not write", () => {
    for (const draft of [
      { ...DRAFT, choices: ["one"] },
      { ...DRAFT, method: "ranked" },
      { ...DRAFT, closing: { kind: "chosen" } },
      { ...DRAFT, attribution: { kind: "named" } },
      { ...DRAFT, promised: "yes" },
      null,
    ]) {
      const store = memory();
      store.setItem("pulse.newPollDraft", JSON.stringify({ draft, at: 0 }));
      expect(readDraft(store, 1), JSON.stringify(draft)).toBeNull();
    }
    const store = memory();
    store.setItem("pulse.newPollDraft", "not json");
    expect(readDraft(store, 1)).toBeNull();
  });

  it("does nothing, and throws nothing, without storage", () => {
    expect(() => keepDraft(DRAFT, null)).not.toThrow();
    expect(readDraft(null)).toBeNull();
    expect(() => forgetDraft(null)).not.toThrow();
  });
});
