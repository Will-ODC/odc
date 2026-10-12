// @vitest-environment jsdom
import { expect, it } from "vitest";
import { nextFor, closingNote, cardStatus } from "../src/flow/conversation.js";
import { poll, results } from "./stub-api.js";
it("approval navigation uses the lowest selected position, not pick order or first nonempty edge", () => {
  const p = poll({
    method: "approval",
    choices: ["A", "B", "C"],
    next: [null, "b", "c"],
  });
  expect(nextFor(p, [2, 1])).toBe("b");
  expect(nextFor(p, [2, 0])).toBeNull();
  expect(nextFor(p, [])).toBeNull();
  expect(nextFor(p, [-1, 9])).toBeNull();
});
it("a closed poll outranks counted or failed cast state", () => {
  expect(
    cardStatus(poll({ open: false }), {
      status: "counted",
      choice: 0,
      ballot: [0],
      changed: false,
      results: results(),
    }),
  ).toEqual({ kind: "closed" });
  expect(cardStatus(poll(), { status: "closed" })).toEqual({ kind: "closed" });
  expect(cardStatus(poll(), { status: "failed", message: "Retry" })).toEqual({
    kind: "failed",
    message: "Retry",
  });
});
it("closing copy does not invent a date", () => {
  expect(closingNote(poll())).toContain("while this question is open");
  expect(closingNote(poll({ closesAt: "invalid" }))).not.toContain("Invalid");
  expect(closingNote(poll({ open: false }))).toContain("closed");
});
