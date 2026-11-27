// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Browse } from "../src/screens/Browse.js";
import type { Contribution } from "../src/api/contributions.js";
import { routeFrom, pathOf, type ReturnTo } from "../src/flow/route.js";
import { rememberReturn, takeReturn } from "../src/flow/sign-in-return.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("round trips contribution routes and sign-in returns including case-sensitive IDs", () => {
  const routes = [
    {
      kind: "browse" as const,
      community: "pulse-general",
      filter: "contributions" as const,
    },
    { kind: "newContribution" as const },
    { kind: "contribution" as const, id: "Ab/C" },
  ];
  for (const route of routes) expect(routeFrom(pathOf(route))).toEqual(route);
  expect(routeFrom("/contributions")).toEqual(routes[0]);
  for (const to of routes.slice(1) as ReturnTo[]) {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    expect(routeFrom(pathOf({ kind: "signIn", returnTo: to }))).toEqual({
      kind: "signIn",
      returnTo: to,
    });
    rememberReturn(to, storage, 100);
    expect(takeReturn(storage, 101)).toEqual(to);
  }
});

it("filters Home to contributions and can load older results", async () => {
  const listPolls = vi.fn();
  const list = vi
    .fn()
    .mockResolvedValueOnce({ contributions: [fixture()], nextCursor: "older" })
    .mockResolvedValueOnce({
      contributions: [
        fixture({
          id: "old",
          title: "An older project",
          createdAt: "2026-11-10T12:00:00.000Z",
        }),
      ],
      nextCursor: null,
    });
  render(
    <Browse
      api={stubApi({ listPolls })}
      community="pulse-general"
      contributionsOnly
      contributionsClient={client({ list })}
    />,
  );
  expect(
    await screen.findByRole("link", { name: "Make the park accessible" }),
  ).toBeTruthy();
  expect(listPolls).not.toHaveBeenCalled();
  expect(
    screen.getByRole("link", { name: "Show all" }).getAttribute("href"),
  ).toBe("/");
  await userEvent.click(
    screen.getByRole("button", { name: "Load more contributions" }),
  );
  expect(
    await screen.findByRole("link", { name: "An older project" }),
  ).toBeTruthy();
  expect(list).toHaveBeenLastCalledWith("older");
});

it("ignores a late contribution page after the list source changes", async () => {
  let finish!: (value: {
    contributions: Contribution[];
    nextCursor: null;
  }) => void;
  const oldList = vi
    .fn()
    .mockResolvedValueOnce({ contributions: [fixture()], nextCursor: "older" })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const newList = vi.fn().mockResolvedValue({
    contributions: [fixture({ id: "new", title: "New source" })],
    nextCursor: null,
  });
  const view = render(
    <Browse
      api={stubApi()}
      community="pulse-general"
      contributionsOnly
      contributionsClient={{ list: oldList }}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more contributions" }),
  );
  view.rerender(
    <Browse
      api={stubApi()}
      community="pulse-general"
      contributionsOnly
      contributionsClient={{ list: newList }}
    />,
  );
  expect(await screen.findByRole("link", { name: "New source" })).toBeTruthy();
  await act(async () =>
    finish({
      contributions: [fixture({ id: "late", title: "Late old page" })],
      nextCursor: null,
    }),
  );
  expect(screen.queryByRole("link", { name: "Late old page" })).toBeNull();
});

it("lists tagged contributions between newer and older polls on Home", async () => {
  const user = userEvent.setup();
  const poll = (id: string, question: string, createdAt: string) => ({
    id,
    question,
    method: "single" as const,
    open: true,
    createdAt,
    closesAt: null,
  });
  const listPolls = vi
    .fn()
    .mockResolvedValueOnce({
      polls: [
        poll("park", "Newer poll", "2026-11-12T12:00:00.000Z"),
        poll("older", "Older poll", "2026-11-10T12:00:00.000Z"),
      ],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      polls: [poll("oldest", "Oldest poll", "2026-11-09T12:00:00.000Z")],
      nextCursor: null,
    });
  render(
    <Browse
      api={stubApi({ listPolls })}
      community="pulse-general"
      contributionsClient={client()}
    />,
  );
  const contribution = await screen.findByRole("link", {
    name: "Make the park accessible",
  });
  expect(contribution.getAttribute("href")).toBe("/contributions/park");
  const tag = document.getElementById(
    contribution.getAttribute("aria-describedby") ?? "",
  );
  expect(tag?.textContent).toBe("Contribution · Community project");
  const list = within(
    screen.getByRole("region", { name: "Explore" }),
  ).getByRole("list");
  expect(
    within(list)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Newer poll", "Make the park accessible", "Older poll"]);
  expect(
    within(list).getByText("Contribution · Community project"),
  ).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Contributions only" })
      .getAttribute("href"),
  ).toBe("/?filter=contributions");

  await user.click(screen.getByRole("button", { name: "Load more questions" }));
  const oldest = await within(list).findByRole("link", { name: "Oldest poll" });
  await waitFor(() => expect(document.activeElement).toBe(oldest));
});

it("keeps Home polls available when the contribution feed fails", async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ contributions: [fixture()], nextCursor: null });
  render(
    <Browse
      api={stubApi({
        listPolls: async () => ({
          polls: [
            {
              id: "park",
              question: "A park poll",
              method: "single",
              open: true,
              createdAt: "2026-11-12T12:00:00.000Z",
              closesAt: null,
            },
          ],
          nextCursor: null,
        }),
      })}
      community="pulse-general"
      contributionsClient={{ list }}
    />,
  );
  const retry = await screen.findByRole("button", {
    name: "Try contributions again",
  });
  expect(screen.getByText("Could not load this. Try again.")).toBeTruthy();
  const question = await screen.findByRole("link", { name: "A park poll" });
  await userEvent.click(retry);
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Explore" }),
  );
  expect(
    await screen.findByRole("link", { name: "Make the park accessible" }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "A park poll" })).toBe(question);
});
