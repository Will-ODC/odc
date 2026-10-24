// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsPanel } from "../src/components/ResultsPanel.js";
import { results } from "./stub-api.js";

afterEach(cleanup);

const COUNTED = results({
  voters: 10,
  choices: [
    { index: 0, label: "No", count: 3, share: 30 },
    { index: 1, label: "Yes", count: 7, share: 70 },
  ],
});

function show(over: Partial<Parameters<typeof ResultsPanel>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <ResultsPanel
      results={COUNTED}
      yourChoices={[1]}
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

describe("showing where a question stands", () => {
  it("gives every choice its own count and share", () => {
    show();
    expect(screen.getByText("3 · 30%")).toBeTruthy();
    expect(screen.getByText("7 · 70%")).toBeTruthy();
  });

  /*
   * "Votes", not "people": the full total counts one vote per browser, and
   * one person on two browsers is two votes (ADR-0040, /trust).
   */
  it("says how many votes there are and how many are confirmed", () => {
    show();
    expect(
      screen.getByText("10 votes so far · 0 confirmed by email"),
    ).toBeTruthy();
  });

  it("does not say 1 votes", () => {
    show({
      results: results({
        voters: 1,
        choices: [{ index: 0, label: "Yes", count: 1, share: 100 }],
      }),
      yourChoices: [0],
    });
    expect(
      screen.getByText("1 vote so far · 0 confirmed by email"),
    ).toBeTruthy();
  });

  it("marks which one was yours", () => {
    show();
    const yours = document.querySelector('[data-yours="true"]');
    expect(yours?.textContent).toContain("Yes");
    expect(yours?.textContent).not.toContain("No");
  });

  it("names your choice back in words, not only as a mark", () => {
    show();
    expect(screen.getByText(/You picked/).textContent).toContain("Yes");
  });

  /**
   * `yourChoices` holds choices' indexes, not a place in the list. ADR-0021 makes
   * position only the display order, so results may arrive in any order, and
   * the words and the mark must still name the same choice.
   */
  it("names the choice whose index you picked, whatever order results arrive in", () => {
    show({
      results: results({
        voters: 10,
        choices: [
          { index: 2, label: "Maybe", count: 2, share: 20 },
          { index: 0, label: "No", count: 3, share: 30 },
          { index: 1, label: "Yes", count: 5, share: 50 },
        ],
      }),
      yourChoices: [1],
    });
    const said = screen.getByText(/You picked/).querySelector("b");
    expect(said?.textContent).toBe("Yes");
    const marked = document.querySelector('[data-yours="true"]');
    expect(marked?.textContent).toContain(said?.textContent);
  });

  /**
   * On an approval poll a ballot names several answers. Every one is marked,
   * and the sentence names them all, in the order the results list them.
   */
  describe("more than one answer of yours", () => {
    const THREE = results({
      method: "approval",
      voters: 10,
      choices: [
        { index: 0, label: "Buses", count: 7, share: 70 },
        { index: 1, label: "Bikes", count: 6, share: 60 },
        { index: 2, label: "Trams", count: 2, share: 20 },
      ],
    });
    const named = () =>
      [...screen.getByText(/You picked/).querySelectorAll("b")].map(
        (b) => b.textContent,
      );
    const marked = () =>
      [...document.querySelectorAll('[data-yours="true"]')].map(
        (row) => row.querySelector(".results__label")?.firstChild?.textContent,
      );

    it("marks every answer you picked, and no other", () => {
      show({ results: THREE, yourChoices: [2, 0] });
      expect(marked()).toEqual(["Buses", "Trams"]);
      expect(screen.getAllByText("yours")).toHaveLength(2);
    });

    it("names two answers joined by 'and'", () => {
      show({ results: THREE, yourChoices: [0, 2] });
      expect(named()).toEqual(["Buses", "Trams"]);
      expect(screen.getByText(/You picked/).textContent).toBe(
        "You picked Buses and Trams.",
      );
    });

    it("names three answers as a list", () => {
      show({ results: THREE, yourChoices: [0, 1, 2] });
      expect(screen.getByText(/You picked/).textContent).toBe(
        "You picked Buses, Bikes and Trams.",
      );
    });

    it("ignores an index the results do not have", () => {
      show({ results: THREE, yourChoices: [1, 9] });
      expect(marked()).toEqual(["Bikes"]);
      expect(screen.getByText(/You picked/).textContent).toBe(
        "You picked Bikes.",
      );
    });
  });

  /**
   * An approval poll's shares legitimately sum past 100, and someone reading
   * "70% and 60%" without being told why is right to think it is broken.
   */
  it("explains shares that add up to more than everybody", () => {
    show({
      results: results({
        method: "approval",
        voters: 10,
        choices: [
          { index: 0, label: "Buses", count: 7, share: 70 },
          { index: 1, label: "Bikes", count: 6, share: 60 },
        ],
      }),
    });
    expect(screen.getByText(/more than everybody/)).toBeTruthy();
  });

  it("says nothing of the sort when only one answer was allowed", () => {
    show();
    expect(screen.queryByText(/more than everybody/)).toBeNull();
  });

  /** Bars are drawn against the widest share, so a short field still reads. */
  it("fills the widest bar completely and the others in proportion", () => {
    show({
      results: results({
        voters: 10,
        choices: [
          { index: 0, label: "No", count: 1, share: 10 },
          { index: 1, label: "Yes", count: 4, share: 40 },
        ],
      }),
    });
    const bars = [...document.querySelectorAll(".results__bar")];
    expect((bars[1] as HTMLElement).style.getPropertyValue("--fill")).toBe(
      "100%",
    );
    expect((bars[0] as HTMLElement).style.getPropertyValue("--fill")).toBe(
      "25%",
    );
  });

  /**
   * Reachable now: a closed poll's results are open to people who did not
   * vote, and a poll can close with nobody having answered it. Empty bars and
   * "0 people" say the same thing worse than a sentence does.
   */
  it("says nobody answered instead of drawing empty bars", () => {
    show({
      results: results({ voters: 0 }),
      yourChoices: [],
      ended: true,
    });
    expect(screen.getByText("Nobody answered this one.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
    expect(screen.queryByText(/0 votes/)).toBeNull();
    expect(screen.queryByText(/confirmed/)).toBeNull();
    // Still a way out.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("says nobody has answered yet while the question is open", () => {
    show({ results: results({ voters: 0 }), yourChoices: [] });
    expect(screen.getByText("Nobody has answered yet.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
  });

  it("does not say 'so far' about a question that has closed", () => {
    show({ ended: true });
    expect(screen.getByText("10 votes · 0 confirmed by email")).toBeTruthy();
    expect(screen.queryByText(/so far/)).toBeNull();
  });

  /** Someone who did not vote sees the results with nothing marked as theirs. */
  it("marks nothing when there is no choice of yours", () => {
    show({ yourChoices: [] });
    expect(screen.getByText("7 · 70%")).toBeTruthy();
    expect(screen.queryByText(/You picked/)).toBeNull();
    expect(document.querySelector('[data-yours="true"]')).toBeNull();
    expect(screen.queryByText("yours")).toBeNull();
  });

  it("gives a way out that is not called Back", () => {
    const { onClose } = show();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.textContent).toBe("×");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The panel stays about the answers. How counting works is the trust
   * page's job (ADR-0039), and the panel must never claim a public record or
   * a check pulse does not have yet - see apps/pulse/CLAUDE.md.
   *
   * Both methods, because they draw different copy: only `approval` renders
   * the note explaining shares that pass a hundred, so a `single`-only scan
   * would let anything written there through.
   */
  it.each(["single", "approval"] as const)(
    "keeps to the answers and claims no record or check (%s)",
    (method) => {
      show({ results: results({ ...COUNTED, method }) });
      const text = document.body.textContent ?? "";
      for (const word of [
        "hash",
        "chain",
        "verif",
        "tally",
        "ledger",
        "tamper",
      ]) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    },
  );

  it("takes focus when it is handed a ref, so it can be read and typed at", () => {
    const panelRef = createRef<HTMLDivElement>();
    show({ panelRef });
    panelRef.current?.focus();
    expect(document.activeElement).toBe(panelRef.current);
    expect(panelRef.current?.getAttribute("tabindex")).toBe("-1");
  });
});

/*
 * #353: both numbers. Every vote (one per browser) and the votes confirmed by
 * email (one per person who signed in, ADR-0040), under each choice and in
 * the count line.
 */
describe("confirmed by email (#353)", () => {
  const CONFIRMED = results({
    voters: 10,
    confirmedVoters: 4,
    choices: [
      {
        index: 0,
        label: "No",
        count: 3,
        share: 30,
        confirmedCount: 1,
        confirmedShare: 25,
      },
      {
        index: 1,
        label: "Yes",
        count: 7,
        share: 70,
        confirmedCount: 3,
        confirmedShare: 75,
      },
    ],
  });

  it("shows both totals in one line", () => {
    show({ results: CONFIRMED });
    expect(
      screen.getByText("10 votes so far · 4 confirmed by email"),
    ).toBeTruthy();
  });

  it("shows both sets of choice counts, each under its own choice", () => {
    show({ results: CONFIRMED });
    const rows = [...document.querySelectorAll(".results__row")];
    expect(rows[0]?.textContent).toContain("3 · 30%");
    expect(rows[0]?.textContent).toContain("1 · 25% confirmed");
    expect(rows[1]?.textContent).toContain("7 · 70%");
    expect(rows[1]?.textContent).toContain("3 · 75% confirmed");
  });

  it("draws the confirmed bars against the widest confirmed share", () => {
    show({ results: CONFIRMED });
    const bars = [
      ...document.querySelectorAll<HTMLElement>(".results__bar--confirmed"),
    ];
    expect(bars.map((bar) => bar.style.getPropertyValue("--fill"))).toEqual([
      "33%",
      "100%",
    ]);
  });

  it("reads nobody confirmed as zero, with no confirmed rows and no error", () => {
    show();
    expect(
      screen.getByText("10 votes so far · 0 confirmed by email"),
    ).toBeTruthy();
    expect(screen.queryByText(/% confirmed/)).toBeNull();
    expect(document.querySelector(".results__bar--confirmed")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The full figures are all still there.
    expect(screen.getByText("7 · 70%")).toBeTruthy();
  });

  it("says the closed count without 'so far'", () => {
    show({ results: CONFIRMED, ended: true });
    expect(screen.getByText("10 votes · 4 confirmed by email")).toBeTruthy();
  });

  /* An email address is not a person: never claim more than an address. */
  it("never calls a confirmed vote verified or a person's only vote", () => {
    show({ results: CONFIRMED, explainHref: "/trust" });
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const word of ["verif", "one per person", "unique", "human"]) {
      expect(text).not.toContain(word);
    }
  });

  it("links 'What does this mean?' to the trust page in a new tab", () => {
    show({ results: CONFIRMED, explainHref: "/trust" });
    const link = screen.getByRole("link", {
      name: "What does this mean? (opens in a new tab)",
    });
    expect(link.getAttribute("href")).toBe("/trust");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("has no explanation link unless given somewhere to point it", () => {
    show({ results: CONFIRMED });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("has nothing to explain when nobody has answered", () => {
    show({ results: results({ voters: 0 }), explainHref: "/trust" });
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("compact question-page results (#453)", () => {
  it("labels separate denominators and uses actual shares for vertical bars", () => {
    show({
      compact: true,
      results: results({
        method: "approval",
        voters: 10,
        confirmedVoters: 4,
        choices: [
          {
            index: 0,
            label: "Library",
            count: 7,
            share: 70,
            confirmedCount: 1,
            confirmedShare: 25,
          },
          {
            index: 1,
            label: "A long name that must wrap on a phone",
            count: 6,
            share: 60,
            confirmedCount: 3,
            confirmedShare: 75,
          },
        ],
      }),
    });
    expect(
      screen.getByText(/share of 10 total votes or 4 email-confirmed votes/),
    ).toBeTruthy();
    expect(screen.getByText("7 · 70% of all votes")).toBeTruthy();
    expect(screen.getByText("1 · 25% confirmed by email")).toBeTruthy();
    expect(screen.getByText(/more than everybody/)).toBeTruthy();
    const bars = [...document.querySelectorAll<HTMLElement>(".results__bar")];
    expect(bars.map((bar) => bar.style.getPropertyValue("--fill"))).toEqual([
      "70%",
      "25%",
      "60%",
      "75%",
    ]);
    expect(
      bars.every((bar) => bar.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("keeps an empty closed result readable without drawing bars", () => {
    show({ compact: true, ended: true, results: results({ voters: 0 }) });
    expect(screen.getByText("Nobody answered this one.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
  });
});
