// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MyVote, MyVotesPage, PollSummary } from "../src/api/types.js";
import { SuggestedVotesRail } from "../src/components/SuggestedVotesRail.js";
import { useSuggestedVotes } from "../src/hooks/use-suggested-votes.js";
import type { ComponentProps } from "react";
import type { ViewData } from "../src/hooks/view-data.js";
import { stubApi } from "./stub-api.js";

function SuggestedVotes({
  current,
  disabled,
  onOpen,
  ...props
}: Parameters<typeof useSuggestedVotes>[0] &
  Pick<
    ComponentProps<typeof SuggestedVotesRail>,
    "current" | "disabled" | "onOpen"
  >) {
  const suggestions = useSuggestedVotes(props);
  return (
    <SuggestedVotesRail
      {...suggestions}
      onRetry={suggestions.retry}
      {...(current ? { current } : {})}
      {...(disabled ? { disabled } : {})}
      {...(onOpen ? { onOpen } : {})}
    />
  );
}

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

it("skips saved and newly answered questions, keeps the open one and opens suggestions without voting", async () => {
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
    <SuggestedVotes
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
    "Current question",
    "Newest open question",
    "Older open question",
  ]);
  expect(newest.getAttribute("href")).toBe("/?poll=newest");
  await userEvent.click(newest);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("newest");
  rerender(
    <SuggestedVotes
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
    <SuggestedVotes
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
    <SuggestedVotes
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

const rows = ["one", "two", "three", "four", "five", "six"].map((id) =>
  row(id, `Question ${id}`),
);
const shown = (sidebar: ReturnType<typeof within>) =>
  sidebar.getAllByRole("link").map((link: HTMLElement) => ({
    question: link.textContent,
    current: link.getAttribute("aria-current"),
  }));
const marked = (questions: string[], current: string) =>
  questions.map((question) => ({
    question,
    current: question === current ? "page" : null,
  }));

it("highlights the open question in its place and keeps the order while browsing", async () => {
  const api = stubApi({
    listPolls: vi.fn().mockResolvedValue({ polls: rows, nextCursor: null }),
  });
  const rail = (current: string, justAnswered: MyVote[] = []) => (
    <SuggestedVotes
      api={api}
      history={history}
      retryHistory={retryHistory}
      justAnswered={justAnswered}
      current={current}
    />
  );
  const { rerender } = render(rail("two"));
  const sidebar = within(
    screen.getByRole("navigation", { name: "Suggested votes" }),
  );
  await sidebar.findByRole("link", { name: "Question two" });
  const firstFive = ["one", "two", "three", "four", "five"].map(
    (id) => `Question ${id}`,
  );
  expect(shown(sidebar)).toEqual(marked(firstFive, "Question two"));

  // Opening another suggestion moves only the highlight.
  rerender(rail("four"));
  expect(shown(sidebar)).toEqual(marked(firstFive, "Question four"));

  // Answering the open one is what takes it out of the list.
  rerender(rail("four", [vote("four")]));
  expect(shown(sidebar)).toEqual(
    marked(
      ["one", "two", "three", "five", "six"].map((id) => `Question ${id}`),
      "",
    ),
  );
});

it("waits for every ballot read, keeps candidate order and retries a failed read", async () => {
  let finish: (ballot: number[] | null) => void = () => {};
  let fail: (reason: Error) => void = () => {};
  const myBallot = vi.fn((id: string) =>
    id === "one"
      ? new Promise<number[] | null>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
      : Promise.resolve(null),
  );
  const api = stubApi({ myBallot });
  const source = {
    data: {
      status: "ready" as const,
      value: { polls: rows, nextCursor: null },
    },
    retry: vi.fn(),
  };
  const partialHistory = {
    status: "ready" as const,
    value: { ...history.value, nextCursor: "older" },
  };
  render(
    <SuggestedVotes
      api={api}
      source={source}
      history={partialHistory}
      retryHistory={retryHistory}
    />,
  );
  const sidebar = within(
    screen.getByRole("navigation", { name: "Suggested votes" }),
  );
  expect(sidebar.getByText("Loading…")).toBeTruthy();
  expect(sidebar.queryAllByRole("link")).toHaveLength(0);
  fail(new Error("Connection lost"));
  await sidebar.findByText("Could not load suggested votes.");
  await userEvent.click(
    sidebar.getByRole("button", { name: "Try suggestions again" }),
  );
  expect(document.activeElement).toBe(sidebar.getByRole("heading"));
  expect(sidebar.getByText("Loading…")).toBeTruthy();
  expect(sidebar.queryAllByRole("link")).toHaveLength(0);
  finish(null);
  await sidebar.findByRole("link", { name: "Question one" });
  expect(sidebar.getAllByRole("link").map((link) => link.textContent)).toEqual(
    rows.slice(0, 5).map((poll) => poll.question),
  );
  expect(source.retry).not.toHaveBeenCalled();
});
