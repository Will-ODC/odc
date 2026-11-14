import { describe, expect, it } from "vitest";
// Test setup imports both apps directly; this workspace declares both dependencies.
// The production browser app repeats the rule; it does not import the server's.
import { normalizeProfile } from "../../../apps/pulse/src/profiles/input.js";
import { nameProblem } from "../../../apps/pulse-web/src/flow/profile-name.js";

/**
 * The editor checks a display name before saving so it can say what is wrong.
 * If its rule drifts from the server's, a name it passes is refused with a
 * message it cannot explain, or one it refuses would have been fine. Every
 * sample must get the same verdict from both.
 */
const SAMPLES = [
  "Ada",
  "  Ada Lovelace  ",
  "Zoë",
  "李小龍",
  "😀",
  "\u{1F469}\u200d\u{1F4BB}",
  "\u{1F469}\u200d\u{1F4BB} Ada",
  "می\u200cخواهم",
  "क्\u200cष",
  "a".repeat(80),
  "😀".repeat(80),
  "",
  "   ",
  "​",
  "\u200c",
  "\u200d",
  "\u200c\u200d",
  "́̈",
  "﻿",
  "Ada​",
  "Ada‎",
  "Ada­",
  "Ada‪",
  "Ada‮",
  "⁦Ada⁩",
  "Ada\u0007",
  "Ada\nLovelace",
  "a".repeat(81),
  "😀".repeat(81),
];

const serverAccepts = (displayName: string) => {
  try {
    normalizeProfile({ displayName, bio: "", visible: true });
    return true;
  } catch {
    return false;
  }
};

describe("display name rule parity", () => {
  it.each(SAMPLES.map((sample) => [JSON.stringify(sample), sample]))(
    "the editor and the server agree on %s",
    (_label, sample) => {
      expect(nameProblem(sample) === undefined).toBe(serverAccepts(sample));
    },
  );

  it("covers both verdicts", () => {
    const verdicts = new Set(SAMPLES.map(serverAccepts));
    expect(verdicts).toEqual(new Set([true, false]));
  });
});
