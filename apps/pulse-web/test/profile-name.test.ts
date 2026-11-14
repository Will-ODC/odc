import { describe, expect, it } from "vitest";
import { bioProblem, nameProblem } from "../src/flow/profile-name.js";

describe("profile name rule", () => {
  it("accepts names with visible text, joiners included", () => {
    for (const name of [
      "Ada",
      " Ada ",
      "Zoë",
      "\u{1F469}‍\u{1F4BB} Ada",
      "می‌خواهم",
      "क्‌ष",
      "a".repeat(80),
      "😀".repeat(80),
    ])
      expect(nameProblem(name)).toBeUndefined();
  });

  it("says why each refused name is refused", () => {
    expect(nameProblem("   ")).toBe("Enter a display name.");
    for (const invisible of ["​", "‍", "‌‍", "́"])
      expect(nameProblem(invisible)).toBe("Enter a name people can see.");
    for (const hidden of ["Ada‮", "Ada‪", "⁦Ada⁩", "Ada‎", "Ada\u0007"])
      expect(nameProblem(hidden)).toBe(
        "Remove the hidden formatting characters from the name.",
      );
    expect(nameProblem("a".repeat(81))).toBe("Use 80 characters or fewer.");
  });

  it("limits a bio by code points and allows it empty", () => {
    expect(bioProblem("")).toBeUndefined();
    expect(bioProblem("😀".repeat(280))).toBeUndefined();
    expect(bioProblem("b".repeat(281))).toBe("Use 280 characters or fewer.");
  });
});
