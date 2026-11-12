// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MyVote, MyVotesPage, PollSummary } from "../src/api/types.js";
import { SuggestedVotesRail } from "../src/components/SuggestedVotesRail.js";
import type { ViewData } from "../src/hooks/view-data.js";
import { stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1100px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

const row = (id: string, question: string, open = true): PollSummary => ({
  id,
  question,
  open,
  method: "single",
  createdAt: "2026-11-11T12:00:00.000Z",
  closesAt: null,
});
const vote = (pollId: string): MyVote => ({
  pollId,
  question: pollId,
  ballot: [0],
  choices: ["Yes"],
  open: true,
  castAt: "2026-11-11T12:00:00.000Z",
  closesAt: null,
});
const history: ViewData<MyVotesPage> = {
  status: "ready",
  value: { votes: [vote("answered")], nextCursor: null },
};
const retryHistory = vi.fn();

it("skips saved and newly answered questions and opens suggestions without voting", async () => {
  const listPolls = vi.fn().mockResolvedValue({
    polls: [
      row("closed", "A closed question", false),
      row("current", "Current question"),
      row("answered", "Answered question"),
      row("newest", "Newest open question"),
      row("older", "Older open question"),
    ],
    nextCursor: null,
  });
  const onOpen = vi.fn();
  const cast = vi.fn();
  const api = stubApi({ listPolls, cast });
  const { rerender } = render(
    <SuggestedVotesRail
      api={api}
      history={history}
      retryHistory={retryHistory}
      current="current"
      onOpen={onOpen}
    />,
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
    <SuggestedVotesRail
      api={api}
      history={history}
      retryHistory={retryHistory}
      current="current"
      disabled
      onOpen={onOpen}
    />,
  );
  await userEvent.click(newest);
  expect(onOpen).toHaveBeenCalledTimes(1);
  rerender(
    <SuggestedVotesRail
      api={api}
      history={history}
      retryHistory={retryHistory}
      justAnswered={[vote("newest")]}
      current="current"
    />,
  );
  expect(
    sidebar.queryByRole("link", { name: "Newest open question" }),
  ).toBeNull();
  expect(
    sidebar.getByRole("link", { name: "Older open question" }),
  ).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
  expect(listPolls).toHaveBeenCalledExactlyOnceWith("pulse-general");
});

it("checks older answers when vote history has another page", async () => {
  const myBallot = vi.fn(async (id: string) =>
    id === "old-answer" ? [0] : null,
  );
  const listPolls = vi.fn().mockResolvedValue({
    polls: [
      row("answered", "Recently answered"),
      row("old-answer", "Answered before the current history page"),
      row("open", "Still unanswered"),
    ],
    nextCursor: null,
  });
  render(
    <SuggestedVotesRail
      api={stubApi({ listPolls, myBallot })}
      history={{
        status: "ready",
        value: { ...history.value, nextCursor: "older" },
      }}
      retryHistory={retryHistory}
    />,
  );
  const sidebar = within(
    screen.getByRole("navigation", { name: "Suggested votes" }),
  );
  expect(
    await sidebar.findByRole("link", { name: "Still unanswered" }),
  ).toBeTruthy();
  expect(sidebar.getAllByRole("link")).toHaveLength(1);
  expect(myBallot.mock.calls.map(([id]) => id)).toEqual(["old-answer", "open"]);
});
