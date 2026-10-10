import { describe, expect, it } from "vitest";
import type { Access, Decision, Eligibility } from "../src/flow/decision.js";
import {
  accessTo,
  canSubmit,
  choiceLabel,
  defineDecision,
  openerLabel,
  privacyNote,
} from "../src/flow/decision.js";

function decision(over: Partial<Decision> = {}): Decision {
  return {
    ...defineDecision({
      id: "d1",
      question: "Which one?",
      choices: [
        { id: "a", label: "Apple" },
        { id: "b", label: "Banana" },
      ],
    }),
    ...over,
  };
}

describe("defining a decision", () => {
  it("is open and private unless told otherwise", () => {
    const made = decision();
    expect(made.open).toBe(true);
    expect(made.privacy).toBe("private");
  });

  it("keeps what it is told", () => {
    const made = defineDecision({
      id: "d2",
      question: "Q",
      choices: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      open: false,
      privacy: "visible",
    });
    expect(made).toEqual({
      id: "d2",
      question: "Q",
      choices: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      open: false,
      privacy: "visible",
    });
  });

  it("refuses fewer than two choices", () => {
    expect(() =>
      defineDecision({
        id: "d3",
        question: "Q",
        choices: [{ id: "x", label: "X" }],
      }),
    ).toThrow(/two choices/);
  });

  it("refuses two choices with one id", () => {
    expect(() =>
      defineDecision({
        id: "d4",
        question: "Q",
        choices: [
          { id: "x", label: "X" },
          { id: "x", label: "Also X" },
        ],
      }),
    ).toThrow(/one id/);
  });
});

describe("who may answer", () => {
  const cases: [boolean, Eligibility, Access][] = [
    [true, "confirmed", "answerable"],
    [true, "unconfirmed", "unconfirmed"],
    [false, "confirmed", "closed"],
    /* Closed outranks unconfirmed: confirming would not open it. */
    [false, "unconfirmed", "closed"],
  ];
  for (const [open, eligibility, expected] of cases) {
    it(`is ${expected} when open=${open} and ${eligibility}`, () => {
      expect(accessTo(decision({ open }), eligibility)).toBe(expected);
    });
  }
});

describe("naming an answer", () => {
  it("finds a choice by its id", () => {
    expect(choiceLabel(decision(), "b")).toBe("Banana");
  });

  it("is null for nothing picked", () => {
    expect(choiceLabel(decision(), null)).toBeNull();
  });

  it("is null for an id that is not one of the choices", () => {
    expect(choiceLabel(decision(), "zzz")).toBeNull();
  });

  /* By id, never by position: reordering must not change what was picked. */
  it("follows the id when the choices are reordered", () => {
    const made = decision();
    const flipped = decision({ choices: [...made.choices].reverse() });
    expect(choiceLabel(flipped, "a")).toBe("Apple");
  });
});

describe("when Submit may send", () => {
  const base = {
    decision: decision(),
    access: "answerable" as Access,
    picked: "a" as string | null,
    sending: false,
  };

  it("sends a picked answer to an answerable decision", () => {
    expect(canSubmit(base)).toBe(true);
  });

  it("does not send with nothing picked", () => {
    expect(canSubmit({ ...base, picked: null })).toBe(false);
  });

  it("does not send a pick that is not one of the choices", () => {
    expect(canSubmit({ ...base, picked: "zzz" })).toBe(false);
  });

  it("does not send twice", () => {
    expect(canSubmit({ ...base, sending: true })).toBe(false);
  });

  it("does not send for someone not yet confirmed", () => {
    expect(canSubmit({ ...base, access: "unconfirmed" })).toBe(false);
  });

  it("does not send to a closed decision", () => {
    expect(canSubmit({ ...base, access: "closed" })).toBe(false);
  });
});

describe("what the person is told", () => {
  it("says a private answer is private", () => {
    expect(privacyNote("private")).toBe("Your answer is private.");
  });

  it("says a visible answer is visible", () => {
    expect(privacyNote("visible")).toMatch(/visible to the group/);
  });

  it("labels the opener by what it will let them do", () => {
    expect(openerLabel("answerable", false)).toBe("Answer");
    expect(openerLabel("answerable", true)).toBe("Change your answer");
    expect(openerLabel("unconfirmed", false)).toBe("See the question");
    expect(openerLabel("closed", true)).toBe("See the question");
  });
});
