// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PollSummary } from "../src/api/types.js";
import { SuggestedVotesRail } from "../src/components/SuggestedVotesRail.js";
import { stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers open questions in feed order and opens them without voting", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1100px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const row = (id: string, question: string, open = true): PollSummary => ({
    id,
    question,
    open,
    method: "single",
    createdAt: "2026-11-11T12:00:00.000Z",
    closesAt: null,
  });
  const listPolls = vi.fn().mockResolvedValue({
    polls: [
      row("closed", "A closed question", false),
      row("current", "Current question"),
      row("newest", "Newest open question"),
      row("older", "Older open question"),
    ],
    nextCursor: null,
  });
  const onOpen = vi.fn();
  const cast = vi.fn();
  const api = stubApi({ listPolls, cast });
  const { rerender } = render(
    <SuggestedVotesRail api={api} current="current" onOpen={onOpen} />,
  );
  const sidebar = within(
    screen.getByRole("navigation", { name: "Suggested votes" }),
  );
  const newest = await sidebar.findByRole("link", {
    name: "Newest open question",
  });
  expect(sidebar.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Newest open question",
    "Older open question",
  ]);
  expect(newest.getAttribute("href")).toBe("/?poll=newest");
  await userEvent.click(newest);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("newest");
  rerender(
    <SuggestedVotesRail api={api} current="current" disabled onOpen={onOpen} />,
  );
  await userEvent.click(newest);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(cast).not.toHaveBeenCalled();
  expect(listPolls).toHaveBeenCalledExactlyOnceWith("pulse-general");
});
