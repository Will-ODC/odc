import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPEN_MS,
  LIMITS,
  byline,
  choiceProblems,
  closingSummary,
  methodSummary,
  postedAsSummary,
  emptyDraft,
  hasProblems,
  length,
  localValue,
  nameProblem,
  pickerMin,
  problemsOf,
  questionProblem,
  requestOf,
} from "../src/flow/new-poll.js";
import type { Draft } from "../src/flow/new-poll.js";

const NOW = new Date(2026, 9, 20, 12, 0).getTime();

function draft(over: Partial<Draft> = {}): Draft {
  return {
    ...emptyDraft(),
    question: "  Open a garden?  ",
    choices: [" Yes", "No "],
    ...over,
  };
}

describe("checking a question before it is posted (ADR-0037)", () => {
  it("counts code points, as the server does, so an emoji is one", () => {
    expect(length("🌱🌱")).toBe(2);
    expect(questionProblem("🌱".repeat(LIMITS.question))).toBeUndefined();
    expect(questionProblem("🌱".repeat(LIMITS.question + 1))).toBe(
      "Keep the question to 1,000 characters or fewer.",
    );
  });

  it("asks for a question that is only spaces", () => {
    expect(questionProblem("   ")).toBe("Write the question.");
  });

  it("flags an empty, a too-long, and a repeated choice, the repeat on its later copy", () => {
    expect(
      choiceProblems(["Yes", " ", "x".repeat(LIMITS.choice + 1), " Yes "]),
    ).toEqual([
      undefined,
      "Write this choice, or remove it.",
      "Keep each choice to 200 characters or fewer.",
      "This choice is already on the list.",
    ]);
    // Exact after trimming: a different case is a different choice.
    expect(choiceProblems(["Yes", "yes"])).toEqual([undefined, undefined]);
  });

  it("asks for a name only when posting under one", () => {
    expect(nameProblem(draft())).toBeUndefined();
    expect(
      nameProblem(draft({ attribution: { kind: "named", name: "  " } })),
    ).toBe("Write the name to show, or post anonymously.");
    expect(
      nameProblem(
        draft({ attribution: { kind: "named", name: "a".repeat(81) } }),
      ),
    ).toBe("Keep the name to 80 characters or fewer.");
  });

  it("needs a closing time after now, when one is picked", () => {
    const at = (local: string) =>
      problemsOf(draft({ closing: { kind: "chosen", local } }), false, NOW)
        .closing;
    expect(at("")).toBe("Pick a date and time.");
    expect(at(localValue(new Date(NOW)))).toBe("Pick a time after now.");
    expect(at(localValue(new Date(NOW + 60_000)))).toBeUndefined();
  });

  it("needs the promise only on a first post", () => {
    expect(problemsOf(draft(), true, NOW).promise).toBe(
      "Tick the promise to post your question.",
    );
    expect(problemsOf(draft(), false, NOW).promise).toBeUndefined();
    expect(
      problemsOf(draft({ promised: true }), true, NOW).promise,
    ).toBeUndefined();
  });

  it("finds nothing wrong with a good draft", () => {
    expect(hasProblems(problemsOf(draft(), false, NOW))).toBe(false);
    expect(hasProblems(problemsOf(emptyDraft(), false, NOW))).toBe(true);
  });
});

describe("the request a draft becomes", () => {
  it("trims, sends no closing time for the default, and posts anonymously", () => {
    expect(requestOf(draft(), false)).toEqual({
      question: "Open a garden?",
      choices: ["Yes", "No"],
      method: "single",
      attribution: { kind: "anonymous" },
    });
  });

  it("drops a typed name when switched back to anonymous", () => {
    expect(
      requestOf(
        draft({ attribution: { kind: "anonymous", name: "Ada" } }),
        false,
      ).attribution,
    ).toEqual({ kind: "anonymous" });
  });

  it("sends a picked time in UTC, a trimmed name, and the promise when made now", () => {
    const local = localValue(new Date(NOW + DEFAULT_OPEN_MS * 2));
    expect(
      requestOf(
        draft({
          method: "approval",
          closing: { kind: "chosen", local },
          attribution: { kind: "named", name: " Ada " },
          promised: true,
        }),
        true,
      ),
    ).toEqual({
      question: "Open a garden?",
      choices: ["Yes", "No"],
      method: "approval",
      closesAt: new Date(local).toISOString(),
      attribution: { kind: "named", name: "Ada" },
      purposeAcknowledgement: "community-purpose-v1",
    });
  });

  it("offers times from the next whole minute", () => {
    expect(pickerMin(new Date(2026, 9, 20, 12, 0, 30).getTime())).toBe(
      "2026-10-20T12:01",
    );
  });
});

describe("who posted it", () => {
  it("says anonymous, a chosen name, or nothing for an older poll", () => {
    expect(byline({ kind: "anonymous" })).toBe("Posted anonymously");
    expect(byline({ kind: "named", name: "Ada" })).toBe("Posted by Ada");
    expect(byline(undefined)).toBeNull();
  });
});

describe("the one-line summaries", () => {
  it("says each default, and each change", () => {
    expect(methodSummary(draft())).toBe("People pick one choice");
    expect(methodSummary(draft({ method: "approval" }))).toBe(
      "People pick any number of choices",
    );
    expect(closingSummary(draft(), NOW)).toMatch(
      /^Closes in seven days, on Oct 27, 2026/,
    );
    expect(
      closingSummary(draft({ closing: { kind: "chosen", local: "" } }), NOW),
    ).toBe("Closes at a time you pick");
    expect(postedAsSummary(draft())).toBe("Posted anonymously");
    expect(
      postedAsSummary(draft({ attribution: { kind: "named", name: " " } })),
    ).toBe("Posted under a name you choose");
    expect(
      postedAsSummary(draft({ attribution: { kind: "named", name: " Ada " } })),
    ).toBe("Posted by Ada");
  });
});
