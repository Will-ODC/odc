import { describe, expect, it } from "vitest";
import type { Poll } from "../src/api/types.js";
import {
  COMMIT_DISTANCE,
  ballotFor,
  choiceFor,
  isSwipeable,
  leanOf,
  releaseOf,
  sideOfKey,
  sideOfPoint,
} from "../src/flow/swipe.js";

const poll = (over: Partial<Poll> = {}): Poll => ({
  id: "p1",
  question: "Should the ODC stay free of paid ads?",
  choices: ["No", "Yes"],
  method: "single",
  closesAt: null,
  open: true,
  ...over,
});

describe("isSwipeable", () => {
  it("accepts a two-choice single-answer poll", () => {
    expect(isSwipeable(poll())).toBe(true);
  });

  it("refuses a third choice, which has no side to land on", () => {
    expect(isSwipeable(poll({ choices: ["No", "Yes", "Abstain"] }))).toBe(
      false,
    );
  });

  it("refuses approval, where two choices can both be picked", () => {
    expect(isSwipeable(poll({ method: "approval" }))).toBe(false);
  });
});

describe("sides", () => {
  it("left is the poll's first choice and right its second", () => {
    expect(choiceFor("left")).toBe(0);
    expect(choiceFor("right")).toBe(1);
    expect(ballotFor("left")).toEqual([0]);
    expect(ballotFor("right")).toEqual([1]);
  });
});

describe("leanOf", () => {
  it("is at rest when nothing has moved", () => {
    expect(leanOf(0)).toEqual({ side: null, strength: 0 });
  });

  it("leans the way the drag went", () => {
    expect(leanOf(-20).side).toBe("left");
    expect(leanOf(20).side).toBe("right");
  });

  it("reaches full strength exactly at the commit distance", () => {
    expect(leanOf(COMMIT_DISTANCE).strength).toBe(1);
    expect(leanOf(COMMIT_DISTANCE / 2).strength).toBeCloseTo(0.5);
  });

  it("stops deepening past the commit distance", () => {
    expect(leanOf(COMMIT_DISTANCE * 5).strength).toBe(1);
    expect(leanOf(-COMMIT_DISTANCE * 5).strength).toBe(1);
  });
});

describe("releaseOf", () => {
  it("commits only once the drag has gone far enough", () => {
    expect(releaseOf(COMMIT_DISTANCE - 1)).toBeNull();
    expect(releaseOf(COMMIT_DISTANCE)).toBe("right");
    expect(releaseOf(-COMMIT_DISTANCE)).toBe("left");
  });

  it("springs back from a short drag either way", () => {
    expect(releaseOf(0)).toBeNull();
    expect(releaseOf(-5)).toBeNull();
  });
});

describe("sideOfPoint", () => {
  it("splits at the seam", () => {
    expect(sideOfPoint(10, 100)).toBe("left");
    expect(sideOfPoint(90, 100)).toBe("right");
  });

  it("gives the seam itself to the left, so no press does nothing", () => {
    expect(sideOfPoint(50, 100)).toBe("left");
  });
});

describe("sideOfKey", () => {
  it("maps the two arrows and nothing else", () => {
    expect(sideOfKey("ArrowLeft")).toBe("left");
    expect(sideOfKey("ArrowRight")).toBe("right");
    expect(sideOfKey("Enter")).toBeUndefined();
    expect(sideOfKey("ArrowUp")).toBeUndefined();
  });
});
