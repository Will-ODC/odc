import { describe, expect, it } from "vitest";
import {
  numberedChoice,
  pickChoice,
  validCardBallot,
} from "../src/flow/vote-card.js";

const choices = [{ index: 7 }, { index: 2 }];
describe("card selections", () => {
  it("replaces a single pick and toggles approval without mutating the input", () => {
    const picked = Object.freeze([7]);
    expect(pickChoice("single", picked, 2)).toEqual([2]);
    expect(pickChoice("approval", picked, 2)).toEqual([7, 2]);
    expect(pickChoice("approval", picked, 7)).toEqual([]);
    expect(picked).toEqual([7]);
  });
  it("validates cardinality, distinctness and membership for both methods", () => {
    expect(validCardBallot("single", choices, [7])).toBe(true);
    expect(validCardBallot("single", choices, [7, 2])).toBe(false);
    expect(validCardBallot("approval", choices, [7, 2])).toBe(true);
    for (const ballot of [[], [7, 7], [0], [-1], [2.5], [NaN]]) {
      expect(validCardBallot("approval", choices, ballot)).toBe(false);
    }
  });
  it("maps row numbers to their indexes and ignores unsupported shortcuts", () => {
    expect(numberedChoice("1", choices)).toBe(7);
    expect(numberedChoice("2", choices)).toBe(2);
    for (const key of ["0", "3", "9", "10", "01", "ArrowRight", " "]) {
      expect(numberedChoice(key, choices)).toBeUndefined();
    }
  });
});
