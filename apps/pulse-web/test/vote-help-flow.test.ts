import { expect, it } from "vitest";
import { guideFor } from "../src/flow/vote-help.js";

it("keeps instruction on the real card phase through selection, retry and results", () => {
  expect(guideFor(false, false, "answerable", false, false).selector).toBe(
    '[data-guide="open"]',
  );
  expect(guideFor(true, true, "answerable", false, false).selector).toBe(
    '[data-guide="open"]',
  );
  expect(guideFor(true, false, "answerable", false, false).selector).toBe(
    ".vote-card__choices",
  );
  expect(guideFor(true, false, "answerable", true, false).text).toMatch(
    /Press Submit/,
  );
  expect(guideFor(true, false, "sending", true, false).text).toMatch(
    /being sent/,
  );
  expect(guideFor(true, false, "failed", true, false).text).toMatch(
    /not saved/,
  );
  expect(guideFor(true, false, "answered", true, false).text).not.toMatch(
    /Next/,
  );
  expect(guideFor(true, false, "answered", true, true).text).toMatch(/Next/);
});
it("never prompts a closed or unconfirmed card to submit even with a selection", () => {
  for (const kind of ["closed", "unconfirmed"] as const) {
    const guide = guideFor(true, false, kind, true, false);
    expect(guide.finished).toBe(true);
    expect(guide.selector).toBe(".vote-card");
    expect(guide.text).not.toMatch(/Press Submit|answer is saved/);
  }
});
