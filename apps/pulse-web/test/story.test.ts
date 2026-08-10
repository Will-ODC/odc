import { describe, expect, it } from "vitest";
import type { Poll } from "../src/api/types.js";
import {
  castLabel,
  isCastable,
  nextStep,
  previousStep,
  progress,
  steps,
  toggleChoice,
  type Story,
} from "../src/flow/story.js";

const story: Story = {
  id: "s1",
  community: "ubc-students",
  communityLabel: "UBC students",
  bites: [
    { caption: "a", headline: "h1", body: "b1" },
    { caption: "b", headline: "h2", body: "b2" },
  ],
  pollId: "p1",
  promise: { headline: "goes to transport", body: "we'll email once" },
  contributions: [],
};

const poll = (over: Partial<Poll> = {}): Poll => ({
  id: "p1",
  question: "Which one?",
  choices: ["a", "b", "c"],
  method: "single",
  closesAt: null,
  open: true,
  ...over,
});

describe("step order", () => {
  it("runs claim, sent, every bite, vote, results, action", () => {
    expect(steps(story).map((s) => s.name)).toEqual([
      "claim",
      "sent",
      "bite",
      "bite",
      "vote",
      "results",
      "action",
    ]);
  });

  it("walks forward through the bites in order", () => {
    expect(nextStep(story, { name: "bite", index: 0 })).toEqual({
      name: "bite",
      index: 1,
    });
    expect(nextStep(story, { name: "bite", index: 1 })).toEqual({
      name: "vote",
    });
  });

  it("stops at the end", () => {
    expect(nextStep(story, { name: "action" })).toBeUndefined();
  });

  it("never walks back into the sign-in panes from the story", () => {
    expect(previousStep(story, { name: "bite", index: 0 })).toBeUndefined();
    expect(previousStep(story, { name: "bite", index: 1 })).toEqual({
      name: "bite",
      index: 0,
    });
  });

  it("counts progress over the bites plus the vote", () => {
    expect(progress(story, { name: "bite", index: 0 })).toEqual({
      total: 3,
      done: 1,
    });
    expect(progress(story, { name: "vote" })).toEqual({ total: 3, done: 3 });
    expect(progress(story, { name: "claim" })).toEqual({ total: 3, done: 0 });
  });
});

describe("single choice", () => {
  it("replaces the selection", () => {
    expect(toggleChoice("single", [], 1)).toEqual([1]);
    expect(toggleChoice("single", [1], 2)).toEqual([2]);
  });

  it("lets you deselect by tapping the same option", () => {
    expect(toggleChoice("single", [1], 1)).toEqual([]);
  });
});

describe("approval", () => {
  it("adds and removes, keeping the ballot ordered", () => {
    expect(toggleChoice("approval", [], 2)).toEqual([2]);
    expect(toggleChoice("approval", [2], 0)).toEqual([0, 2]);
    expect(toggleChoice("approval", [0, 2], 2)).toEqual([0]);
  });
});

describe("casting", () => {
  it("needs at least one choice", () => {
    expect(isCastable(poll(), [], null)).toBe(false);
    expect(isCastable(poll(), [0], null)).toBe(true);
  });

  it("refuses when the poll has closed", () => {
    expect(isCastable(poll({ open: false }), [0], null)).toBe(false);
  });

  it("refuses a re-cast of the identical ballot", () => {
    expect(isCastable(poll(), [1], [1])).toBe(false);
    expect(isCastable(poll(), [2], [1])).toBe(true);
  });

  it("allows a genuine change of vote", () => {
    const approval = poll({ method: "approval" });
    expect(isCastable(approval, [0, 1], [0])).toBe(true);
    expect(isCastable(approval, [0], [0])).toBe(false);
  });
});

describe("the button says what will happen", () => {
  it("prompts before anything is picked", () => {
    expect(castLabel(poll(), [], null)).toBe("Choose an option");
    expect(castLabel(poll({ method: "approval" }), [], null)).toBe(
      "Choose at least one",
    );
  });

  it("counts the selections for approval", () => {
    expect(castLabel(poll({ method: "approval" }), [0, 2], null)).toBe(
      "Cast my vote (2)",
    );
  });

  it("says change, not cast, once a vote exists", () => {
    expect(castLabel(poll(), [2], [1])).toBe("Change my vote");
    expect(castLabel(poll(), [1], [1])).toBe("This is already your vote");
  });

  it("says so when voting has closed", () => {
    expect(castLabel(poll({ open: false }), [1], null)).toBe(
      "Voting has closed",
    );
  });
});
