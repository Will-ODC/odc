// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
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

  /** Nobody can reach this with no votes, but dividing by zero is still a crash. */
  it("draws empty bars rather than throwing when nothing is counted", () => {
    show({
      results: results({
        voters: 0,
        choices: [{ index: 0, label: "Yes", count: 0, share: 0 }],
      }),
      yourChoice: 0,
    });
    const bar = document.querySelector(".results__bar") as HTMLElement;
    expect(bar.style.getPropertyValue("--fill")).toBe("0%");
  });

  it("gives a way back to the question", () => {
    const { onClose } = show();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the question" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** The counting is never the subject - see apps/pulse/CLAUDE.md. */
  it("never mentions how the counting works", () => {
    show();
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
  });
});
