// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResultsPanel } from "../src/components/ResultsPanel.js";
import { results } from "./stub-api.js";

// The chart's code fails to download, as after a deploy renamed its chunk.
vi.mock("../src/components/BarChart.js", () => {
  throw new Error("chunk did not load");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("falls back to the per-answer rows when the chart cannot load", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ResultsPanel
      compact
      results={results({
        voters: 2,
        choices: [
          {
            index: 0,
            label: "Library",
            count: 2,
            share: 100,
            confirmedCount: 0,
            confirmedShare: 0,
          },
        ],
      })}
      yourChoices={[0]}
    />,
  );
  // The rows give every figure: the count and share beside the answer.
  expect(await screen.findByText(/2 · 100%/)).toBeTruthy();
  expect(document.querySelector(".results__list")).not.toBeNull();
  expect(screen.queryByRole("figure")).toBeNull();
});
