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
      yourChoice={1}
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

  it("says how many people have answered", () => {
    show();
    expect(screen.getByText("10 people so far")).toBeTruthy();
  });

  it("does not say 1 people", () => {
    show({
      results: results({
        voters: 1,
        choices: [{ index: 0, label: "Yes", count: 1, share: 100 }],
      }),
      yourChoice: 0,
    });
    expect(screen.getByText("1 person so far")).toBeTruthy();
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
   * `yourChoice` is a choice's index, not a place in the list. ADR-0021 makes
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
      yourChoice: 1,
    });
    const said = screen.getByText(/You picked/).querySelector("b");
    expect(said?.textContent).toBe("Yes");
    const marked = document.querySelector('[data-yours="true"]');
    expect(marked?.textContent).toContain(said?.textContent);
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
      yourChoice: undefined,
      ended: true,
    });
    expect(screen.getByText("Nobody answered this one.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
    expect(screen.queryByText(/0 people/)).toBeNull();
    // Still a way out.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("says nobody has answered yet while the question is open", () => {
    show({ results: results({ voters: 0 }), yourChoice: undefined });
    expect(screen.getByText("Nobody has answered yet.")).toBeTruthy();
    expect(document.querySelector(".results__bar")).toBeNull();
  });

  it("does not say 'so far' about a question that has closed", () => {
    show({ ended: true });
    expect(screen.getByText("10 people answered")).toBeTruthy();
    expect(screen.queryByText(/so far/)).toBeNull();
  });

  /** Someone who did not vote sees the results with nothing marked as theirs. */
  it("marks nothing when there is no choice of yours", () => {
    show({ yourChoice: undefined });
    expect(screen.getByText("7 · 70%")).toBeTruthy();
    expect(screen.queryByText(/You picked/)).toBeNull();
    expect(document.querySelector('[data-yours="true"]')).toBeNull();
    expect(screen.queryByText("yours")).toBeNull();
  });

  it("gives a way out that is not called Back", () => {
    const { onClose } = show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The counting is never the subject - see apps/pulse/CLAUDE.md.
   *
   * Both methods, because they draw different copy: only `approval` renders
   * the note explaining shares that pass a hundred, so a `single`-only scan
   * would let anything written there through.
   */
  it.each(["single", "approval"] as const)(
    "never mentions how the counting works (%s)",
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
