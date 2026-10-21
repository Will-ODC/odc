// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Browse } from "../src/screens/Browse.js";
import { App } from "../src/App.js";
import { routeFrom, pathOf } from "../src/flow/route.js";
import { ApiError, type PollPage, type PollSummary } from "../src/api/types.js";
import { stubApi } from "./stub-api.js";
afterEach(cleanup);
const row = (id: string, open = true): PollSummary => ({
  id,
  question: `Question ${id}`,
  method: "single",
  open,
  createdAt: "2026-10-21T12:00:00.000Z",
  closesAt: null,
});
const page = (
  polls = [row("one")],
  nextCursor: string | null = null,
): PollPage => ({ polls, nextCursor });

it("round-trips browse community links and defaults to General", () => {
  expect(routeFrom("/browse")).toEqual({
    kind: "browse",
    community: "pulse-general",
  });
  const route = { kind: "browse" as const, community: "a/b & c" };
  expect(routeFrom(pathOf(route))).toEqual(route);
});

it("links welcome to exploration while retaining the guided start", async () => {
  const listPolls = vi.fn();
  render(<App api={stubApi({ listPolls })} route={{ kind: "welcome" }} />);
  expect(
    screen
      .getByRole("link", { name: "Explore questions" })
      .getAttribute("href"),
  ).toBe("/browse?community=pulse-general");
  expect(screen.getByRole("button", { name: "Start voting" })).toBeTruthy();
  expect(listPolls).not.toHaveBeenCalled();
});

it("lists open and closed questions as keyboard links without casting", async () => {
  const cast = vi.fn();
  const listPolls = vi
    .fn()
    .mockResolvedValue(page([row("a/b"), row("closed", false)]));
  render(<Browse api={stubApi({ listPolls, cast })} community="campus" />);
  const link = await screen.findByRole("link", { name: "Question a/b" });
  link.focus();
  expect(document.activeElement).toBe(link);
  expect(link.getAttribute("href")).toBe("/?poll=a%2Fb");
  expect(screen.getByText("Closed · View results")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Question closed" }).getAttribute("href"),
  ).toBe("/?poll=closed");
  expect(listPolls).toHaveBeenCalledExactlyOnceWith("campus");
  expect(cast).not.toHaveBeenCalled();
});

it("shows loading, retry and empty states with useful destinations", async () => {
  let reject!: (reason: unknown) => void;
  const listPolls = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    )
    .mockResolvedValue(page([]));
  render(<Browse api={stubApi({ listPolls })} community="missing" />);
  expect(screen.getByText("Loading…")).toBeTruthy();
  await act(async () => reject(new ApiError(503, "Please try later.")));
  expect(await screen.findByText("Please try later.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/No questions here yet/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Starting questions" })
      .getAttribute("href"),
  ).toBe("/questions");
  expect(
    screen.getByRole("link", { name: "Post a question" }).getAttribute("href"),
  ).toBe("/new");
});

it("keeps earlier rows through a failed page and retries the same cursor once", async () => {
  let finish!: (value: PollPage) => void;
  const listPolls = vi
    .fn()
    .mockResolvedValueOnce(page([row("one")], "next"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          finish = yes;
        }),
    );
  render(<Browse api={stubApi({ listPolls })} community="campus" />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more" }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Question one" })).toBeTruthy();
  const user = userEvent.setup();
  await user.dblClick(
    screen.getByRole("button", { name: "Try loading more again" }),
  );
  expect(listPolls).toHaveBeenCalledTimes(3);
  expect(listPolls).toHaveBeenLastCalledWith("campus", "next");
  await act(async () => finish(page([row("one"), row("two")])));
  expect(
    await screen.findByRole("link", { name: "Question two" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Question one" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("ignores an old community page after navigating to another community", async () => {
  let finish!: (value: PollPage) => void;
  const listPolls = vi
    .fn()
    .mockResolvedValueOnce(page([row("old")], "next"))
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          finish = yes;
        }),
    )
    .mockResolvedValueOnce(page([row("new")]));
  const api = stubApi({ listPolls });
  const view = render(<Browse api={api} community="old" />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more" }),
  );
  view.rerender(<Browse api={api} community="new" />);
  await screen.findByRole("link", { name: "Question new" });
  await act(async () => finish(page([row("late")])));
  expect(screen.queryByRole("link", { name: "Question late" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Question old" })).toBeNull();
});

it("offers the signed-in community without requiring it for public browsing", async () => {
  const listPolls = vi.fn().mockResolvedValue(page());
  render(
    <Browse
      api={stubApi({
        listPolls,
        me: async () => ({
          id: "private",
          email: "private@example.test",
          community: "campus",
        }),
      })}
      community="pulse-general"
    />,
  );
  expect(
    (await screen.findByRole("link", { name: "Your community" })).getAttribute(
      "href",
    ),
  ).toBe("/browse?community=campus");
  await waitFor(() => expect(listPolls).toHaveBeenCalledWith("pulse-general"));
  expect(screen.getByRole("main").textContent).not.toContain(
    "private@example.test",
  );
});

it("loads the final page by keyboard and focuses its first new question", async () => {
  const user = userEvent.setup();
  const listPolls = vi
    .fn()
    .mockResolvedValueOnce(page([row("first")], "next"))
    .mockResolvedValueOnce(page([row("second")]));
  render(<Browse api={stubApi({ listPolls })} community="pulse-general" />);
  await screen.findByRole("button", { name: "Load more" });
  await user.tab(); // First question
  await user.tab(); // Load more
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Load more" }),
  );
  await user.keyboard("{Enter}");
  const next = await screen.findByRole("link", { name: "Question second" });
  await waitFor(() => expect(document.activeElement).toBe(next));
  expect(listPolls).toHaveBeenLastCalledWith("pulse-general", "next");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("keeps home, guided questions and posting in the top navigation", async () => {
  render(
    <Browse
      api={stubApi({ listPolls: async () => page([]) })}
      community="pulse-general"
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Browse navigation" });
  expect(nav.querySelector('a[href="/"]')?.textContent).toBe("Home");
  expect(nav.querySelector('a[href="/questions"]')?.textContent).toBe(
    "Starting questions",
  );
  expect(
    screen.getByRole("link", { name: "Post a question" }).getAttribute("href"),
  ).toBe("/new");
  await screen.findByText(/No questions here yet/);
});
