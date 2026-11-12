// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Contributions } from "../src/screens/Contributions.js";
import { Browse } from "../src/screens/Browse.js";
import { NewContribution } from "../src/screens/NewContribution.js";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import type {
  Contribution,
  ContributionsApi,
} from "../src/api/contributions.js";
import { HttpContributionsApi } from "../src/api/contributions.js";
import { routeFrom, pathOf, type ReturnTo } from "../src/flow/route.js";
import { rememberReturn, takeReturn } from "../src/flow/sign-in-return.js";
import { stubApi } from "./stub-api.js";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const fixture = (over: Partial<Contribution> = {}): Contribution => ({
  id: "park",
  title: "Make the park accessible",
  description: "Build a ramp together.",
  communityBenefit: "Everyone can reach the garden.",
  needs: "Carpenters and materials",
  kind: "project",
  organizerName: "Test organizer",
  community: { id: "pulse-general", label: "General" },
  pollId: null,
  commercial: null,
  fund: null,
  status: "open",
  createdAt: "2026-11-11T12:00:00.000Z",
  participations: [],
  updates: [],
  ...over,
});
const client = (over: Partial<ContributionsApi> = {}): ContributionsApi => ({
  list: async () => ({ contributions: [fixture()], nextCursor: null }),
  detail: async () => ({ contribution: fixture(), canManage: false }),
  create: async () => fixture(),
  participate: async () => fixture(),
  update: async () => fixture(),
  ...over,
});

it("round trips contribution routes and sign-in returns including case-sensitive IDs", () => {
  const routes = [
    { kind: "contributions" as const },
    { kind: "newContribution" as const },
    { kind: "contribution" as const, id: "Ab/C" },
  ];
  for (const route of routes) expect(routeFrom(pathOf(route))).toEqual(route);
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
it("shows loading, readable cards and an empty path to creation", async () => {
  const never = new Promise<never>(() => {});
  const { unmount } = render(
    <Contributions api={stubApi()} client={client({ list: () => never })} />,
  );
  expect(screen.getByText("Loading…")).toBeTruthy();
  unmount();
  const ready = render(<Contributions api={stubApi()} client={client()} />);
  const link = await screen.findByRole("link", {
    name: "Make the park accessible",
  });
  link.focus();
  expect(document.activeElement).toBe(link);
  expect(link.getAttribute("href")).toBe("/contributions/park");
  ready.unmount();
  render(
    <Contributions
      api={stubApi()}
      client={client({
        list: async () => ({ contributions: [], nextCursor: null }),
      })}
    />,
  );
  expect(
    await screen.findByRole("link", { name: "Post the first contribution" }),
  ).toBeTruthy();
});
it("retries failed contribution loads without replacing the page", async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost."))
    .mockResolvedValue({ contributions: [fixture()], nextCursor: null });
  render(<Contributions api={stubApi()} client={client({ list })} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Try again" }),
  );
  expect(
    await screen.findByRole("link", { name: "Make the park accessible" }),
  ).toBeTruthy();
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
    screen.getByRole("link", { name: "Contributions" }).getAttribute("href"),
  ).toBe("/contributions");

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

it("requires sign-in before creating and retains the intended return", async () => {
  render(
    <NewContribution api={stubApi()} client={client()} onCreated={vi.fn()} />,
  );
  expect(
    await screen.findByRole("heading", { name: "Sign in to get started" }),
  ).toBeTruthy();
  const links = screen.getAllByRole("link", { name: "Sign in" });
  expect(
    links.some(
      (link) => link.getAttribute("href") === "/sign-in?next=contribution-new",
    ),
  ).toBe(true);
});
it("confirms a public participation and reuses its key after uncertain failure", async () => {
  const user = userEvent.setup();
  const participate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost. Please try again."))
    .mockResolvedValue(fixture());
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client({ participate })}
    />,
  );
  await screen.findByRole("heading", { name: "Make the park accessible" });
  await user.type(screen.getByLabelText("Your public name"), "Test helper");
  await user.type(
    screen.getByLabelText(/Your contribution/),
    "I can help build the ramp.",
  );
  await user.click(
    screen.getByRole("button", { name: "Publish my contribution" }),
  );
  expect(participate).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this contribution/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish my contribution" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Connection lost. Please try again.",
  );
  await user.click(
    screen.getByRole("button", { name: "Publish my contribution" }),
  );
  await waitFor(() => expect(participate).toHaveBeenCalledTimes(2));
  expect(participate.mock.calls[0]?.[2]).toBe(participate.mock.calls[1]?.[2]);
  expect(await screen.findByRole("status", { name: "" })).toBeTruthy();
});
it("closed contributions allow reports and display commercial/fund claims honestly", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client({
        detail: async () => ({
          canManage: false,
          contribution: fixture({
            status: "completed",
            commercial: {
              currency: "CAD",
              regularPriceMinor: 10000,
              offeredPriceMinor: 7500,
              referenceUrl: "https://example.com/price",
              terms: "Collect from the organizer.",
            },
            fund: { name: "Garden fund", percentage: 10 },
          }),
        }),
      })}
    />,
  );
  expect(await screen.findByText("25% advertised savings")).toBeTruthy();
  expect(screen.getByText(/organizer pledges 10%/)).toBeTruthy();
  const select = screen.getByLabelText("How would you like to contribute?");
  expect(
    within(select).queryByRole("option", { name: "Offer help" }),
  ).toBeNull();
  expect(
    within(select).getByRole("option", { name: "Report work done" }),
  ).toBeTruthy();
});
it("rejects malformed successful responses and sends credentials/idempotency keys", async () => {
  const doFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ contribution: {} })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ contribution: fixture(), replayed: false }),
      ),
    );
  const api = new HttpContributionsApi(doFetch);
  await expect(api.detail("park")).rejects.toThrow("could not be read");
  await api.participate(
    "park",
    { kind: "help", displayName: "Helper", message: "Help" },
    "request-key",
  );
  expect(doFetch.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    headers: { "Idempotency-Key": "request-key" },
  });
});

it("requires meaningful savings and confirms publishing an offer with a fund pledge", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue(fixture());
  const onCreated = vi.fn();
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client({ create })}
      onCreated={onCreated}
    />,
  );
  await user.selectOptions(
    await screen.findByLabelText("Contribution type"),
    "group_buy",
  );
  await user.type(screen.getByLabelText("Title"), "Community tool purchase");
  await user.type(screen.getByLabelText("Description"), "Buy tools together.");
  await user.type(
    screen.getByLabelText("How will the community benefit?"),
    "Lower prices for neighbours.",
  );
  await user.type(
    screen.getByLabelText(/What help or resources/),
    "Ten buyers",
  );
  await user.type(
    screen.getByLabelText(/Organizer’s public name/),
    "Test organizer",
  );
  await user.type(screen.getByLabelText("Regular price"), "100");
  await user.type(screen.getByLabelText("Community price"), "95");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "The community price must save at least 20% against the comparable regular price.",
  );
  await user.clear(screen.getByLabelText("Community price"));
  await user.type(screen.getByLabelText("Community price"), "75");
  await user.type(
    screen.getByLabelText("Comparable price source"),
    "https://example.com/price",
  );
  await user.type(
    screen.getByLabelText(/Offer terms/),
    "Ten orders required. Collection included.",
  );
  await user.click(screen.getByRole("checkbox", { name: /Pledge a share/ }));
  await user.type(
    screen.getByLabelText("Fund or beneficiary name"),
    "Garden fund",
  );
  await user.type(screen.getByLabelText("Share of sales proceeds (%)"), "10");
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(create).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm these details/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    kind: "group_buy",
    commercial: {
      regularPriceMinor: 10000,
      offeredPriceMinor: 7500,
      currency: "CAD",
    },
    fund: { name: "Garden fund", percentage: 10 },
  });
  expect(onCreated).toHaveBeenCalledWith("park");
});
