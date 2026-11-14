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
import { NewContribution } from "../src/screens/NewContribution.js";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import type {
  Contribution,
  ContributionsApi,
} from "../src/api/contributions.js";
import {
  ContributionsError,
  HttpContributionsApi,
} from "../src/api/contributions.js";
import { routeFrom, pathOf, type ReturnTo } from "../src/flow/route.js";
import { rememberReturn, takeReturn } from "../src/flow/sign-in-return.js";
import { stubApi } from "./stub-api.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
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
  sendMessage: async () => {},
  messages: async () => [],
  detail: async () => ({ contribution: fixture(), canManage: false }),
  create: async () => fixture(),
  participate: async () => fixture(),
  update: async () => fixture(),
  ...over,
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
it("opens a private message only on request and reuses the key on retry", async () => {
  const user = userEvent.setup();
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost. Please try again."))
    .mockResolvedValue(undefined);
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "reader",
          email: "reader@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({ sendMessage })}
    />,
  );
  const disclosure = await screen.findByText("Message the organizer");
  expect(disclosure.closest("details")?.open).toBe(false);
  await user.click(disclosure);
  expect(
    screen.getByText(
      "Only the organizer can read this. They can't reply here.",
    ),
  ).toBeTruthy();
  await user.type(
    await screen.findByLabelText("Private message"),
    "I can help build the ramp.",
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Connection lost. Please try again.",
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText("Message sent to the organizer."),
  ).toBeTruthy();
  expect(sendMessage).toHaveBeenCalledWith(
    "park",
    "I can help build the ramp.",
    expect.any(String),
  );
  expect(sendMessage.mock.calls[0]?.[2]).toBe(sendMessage.mock.calls[1]?.[2]);
});
it("offers signed-out people a new-tab sign-in for help and messages", async () => {
  render(<ContributionDetail api={stubApi()} id="park" client={client()} />);
  const help = await screen.findByRole("link", {
    name: "Sign in to offer help or make a pledge",
  });
  expect(help.getAttribute("target")).toBe("_blank");
  await userEvent.click(screen.getByText("Message the organizer"));
  expect(
    screen
      .getByRole("link", { name: "Sign in to send a message" })
      .getAttribute("target"),
  ).toBe("_blank");
});

it("reopens the message form after signing in from its new tab", async () => {
  let me: { id: string; email: string; community: null } | null = null;
  // The reload for the new account waits until the test lets it answer, so
  // the test can see what is on screen meanwhile; without that, act() batches
  // the "Loading…" state away and this would pass against a page that hides.
  let answer: () => void = () => {};
  const detail = vi
    .fn()
    .mockResolvedValueOnce({ contribution: fixture(), canManage: false })
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ contribution: fixture(), canManage: false });
        }),
    );
  render(
    <ContributionDetail
      api={stubApi({ me: async () => me })}
      id="park"
      client={client({ detail })}
    />,
  );
  await userEvent.click(await screen.findByText("Message the organizer"));
  expect(
    screen.getByRole("link", { name: "Sign in to send a message" }),
  ).toBeTruthy();
  const box = screen.getByText("Message the organizer").closest("details");
  const title = screen.getByRole("heading", { level: 1 });
  me = { id: "reader", email: "reader@example.test", community: null };
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
  // While it reloads for the new account, the page stays: the same box,
  // still open, and no "Loading…" in its place.
  expect(screen.queryByText("Loading…")).toBeNull();
  expect(screen.getByText("Message the organizer").closest("details")).toBe(
    box,
  );
  expect(box?.open).toBe(true);
  await act(async () => answer());
  expect(await screen.findByLabelText("Private message")).toBeTruthy();
  expect(screen.getByText("Message the organizer").closest("details")).toBe(
    box,
  );
  expect(box?.open).toBe(true);
  expect(screen.getByRole("heading", { level: 1 })).toBe(title);
});

it("records an offer of help and shows the shared date style", async () => {
  const participate = vi.fn().mockResolvedValue(
    fixture({
      participations: [
        {
          id: "help-1",
          displayName: "Jo",
          kind: "help",
          message: "I can build the ramp.",
          createdAt: "2026-11-15T12:00:00.000Z",
        },
      ],
    }),
  );
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "helper",
          email: "helper@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({ participate })}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Public name"), "Jo");
  await user.type(
    screen.getByLabelText("How you can help"),
    "I can build the ramp.",
  );
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  expect(await screen.findByText("I can build the ramp.")).toBeTruthy();
  expect(screen.getByText("Nov 15, 2026")).toBeTruthy();
  expect(participate).toHaveBeenCalledWith(
    "park",
    { displayName: "Jo", kind: "help", message: "I can build the ramp." },
    expect.any(String),
  );
});

it("keeps the chosen kind and name for a second pledge, and says when one person has given enough", async () => {
  const participate = vi
    .fn()
    .mockResolvedValueOnce(
      fixture({
        participations: [
          {
            id: "pledge-1",
            displayName: "Jo",
            kind: "pledge",
            message: "Two bags of soil.",
            createdAt: "2026-11-15T12:00:00.000Z",
          },
        ],
      }),
    )
    .mockRejectedValueOnce(
      new ContributionsError(
        409,
        "You have added as many entries to this contribution as one person can.",
      ),
    );
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "helper",
          email: "helper@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({ participate })}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("radio", { name: "Make a pledge" }));
  await user.type(screen.getByLabelText("Public name"), "Jo");
  await user.type(
    screen.getByLabelText("What you pledge"),
    "Two bags of soil.",
  );
  await user.click(screen.getByRole("button", { name: "Make pledge" }));
  expect(
    await screen.findByText("Thank you. Your entry is on this page."),
  ).toBeTruthy();
  expect(participate).toHaveBeenLastCalledWith(
    "park",
    { displayName: "Jo", kind: "pledge", message: "Two bags of soil." },
    expect.any(String),
  );
  expect(
    (screen.getByRole("radio", { name: "Make a pledge" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect((screen.getByLabelText("Public name") as HTMLInputElement).value).toBe(
    "Jo",
  );
  const message = screen.getByLabelText(
    "What you pledge",
  ) as HTMLTextAreaElement;
  expect(message.value).toBe("");
  await user.type(message, "One more bag.");
  await user.click(screen.getByRole("button", { name: "Make pledge" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "You have added as many entries to this contribution as one person can.",
  );
  expect(message.value).toBe("One more bag.");
});

it("does not offer help or pledges on a closed contribution", async () => {
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "helper",
          email: "helper@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({
          contribution: fixture({ status: "completed" }),
          canManage: false,
        }),
      })}
    />,
  );
  expect(
    await screen.findByText(
      "This contribution is closed to new offers of help and pledges.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Public name")).toBeNull();
});

it("keeps the organizer's new status selected after publishing an update", async () => {
  const update = vi.fn().mockResolvedValue(
    fixture({
      status: "in_progress",
      updates: [
        {
          id: "update-1",
          message: "Work started.",
          status: "in_progress",
          evidenceUrl: null,
          createdAt: "2026-11-15T12:00:00.000Z",
        },
      ],
    }),
  );
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        update,
      })}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Post an update"));
  await user.selectOptions(
    screen.getByLabelText("Current status"),
    "in_progress",
  );
  await user.type(screen.getByLabelText("Progress update"), "Work started.");
  await user.click(
    screen.getByRole("checkbox", { name: /confirm this status/ }),
  );
  await user.click(screen.getByRole("button", { name: "Publish update" }));
  await screen.findByText("Work started.");
  expect(screen.getByText("Your update has been published.")).toBeTruthy();
  expect(
    (screen.getByLabelText("Current status") as HTMLSelectElement).value,
  ).toBe("in_progress");
  expect(screen.getByText("Nov 15, 2026")).toBeTruthy();
});

it("offers a new-tab sign-in after an organizer update loses authentication", async () => {
  const update = vi
    .fn()
    .mockRejectedValue(
      new ContributionsError(
        401,
        "Sign in to continue. Your entries are still here.",
      ),
    );
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        update,
      })}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Post an update"));
  await user.type(screen.getByLabelText("Progress update"), "Work started.");
  await user.click(
    screen.getByRole("checkbox", { name: /confirm this status/ }),
  );
  await user.click(screen.getByRole("button", { name: "Publish update" }));
  expect(
    await screen.findByRole("link", { name: "Sign in again in a new tab" }),
  ).toHaveProperty("target", "_blank");
});

it("removes organizer controls when account A changes directly to account B", async () => {
  let account = "owner";
  const api = stubApi({
    me: async () => ({
      id: account,
      email: `${account}@example.test`,
      community: null,
    }),
  });
  const detail = vi.fn(async () => ({
    contribution: fixture(),
    canManage: account === "owner",
  }));
  render(
    <ContributionDetail api={api} id="park" client={client({ detail })} />,
  );
  expect(
    await screen.findByText("Private messages", { exact: true }),
  ).toBeTruthy();
  account = "other";
  window.dispatchEvent(new Event("focus"));
  expect(await screen.findByText("Message the organizer")).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByText("Private messages", { exact: true })).toBeNull(),
  );
});
it("removes an open private inbox as soon as the organizer signs out", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn(async () => {});
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
        signOut,
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        messages: async () => [
          {
            id: "message",
            message: "Only the organizer can read this.",
            createdAt: fixture().createdAt,
          },
        ],
      })}
    />,
  );
  await user.click(
    await screen.findByText("Private messages", { exact: true }),
  );
  expect(
    await screen.findByText("Only the organizer can read this."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
  await waitFor(() =>
    expect(screen.queryByText("Only the organizer can read this.")).toBeNull(),
  );
  expect(screen.queryByText("Private messages", { exact: true })).toBeNull();
});
it("removes an open private inbox when the organizer signs out in another tab", async () => {
  const user = userEvent.setup();
  let answer: "owner" | "nobody" | "offline" = "owner";
  const me = vi.fn(async () => {
    if (answer === "offline") throw new Error("Offline");
    return answer === "owner"
      ? { id: "owner", email: "owner@example.test", community: null }
      : null;
  });
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        messages: async () => [
          {
            id: "message",
            message: "Only the organizer can read this.",
            createdAt: fixture().createdAt,
          },
        ],
      })}
    />,
  );
  await user.click(
    await screen.findByText("Private messages", { exact: true }),
  );
  expect(
    await screen.findByText("Only the organizer can read this."),
  ).toBeTruthy();
  // A failed check is not an answer: the inbox stays.
  answer = "offline";
  const calls = me.mock.calls.length;
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(me.mock.calls.length).toBe(calls + 1));
  await act(async () => {});
  expect(screen.getByText("Only the organizer can read this.")).toBeTruthy();
  // A definite "nobody is signed in" is: the inbox goes.
  answer = "nobody";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByText("Only the organizer can read this.")).toBeNull(),
  );
  expect(screen.queryByText("Private messages", { exact: true })).toBeNull();
  // Still their own post: no "Message the organizer" form in its place.
  expect(
    screen.getByText("Sign in again to read your private messages."),
  ).toBeTruthy();
  expect(screen.queryByText("Message the organizer")).toBeNull();
});

it("lists each private message under a line with its date", async () => {
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        messages: async () => [
          {
            id: "message",
            message: "I can bring wood.",
            createdAt: "2026-11-15T12:00:00.000Z",
          },
        ],
      })}
    />,
  );
  await userEvent.click(
    await screen.findByText("Private messages", { exact: true }),
  );
  const message = await screen.findByText("I can bring wood.");
  const entry = message.closest("li");
  const meta = entry?.querySelector(".contribution-meta");
  expect(meta?.textContent).toBe("Nov 15, 2026");
  expect(entry?.firstElementChild).toBe(meta);
});

it("styles every control on the contribution page as a shared field", async () => {
  const user = userEvent.setup();
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "owner",
          email: "owner@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
      })}
    />,
  );
  await user.click(await screen.findByText("Post an update"));
  for (const label of [
    "Public name",
    "How you can help",
    "Current status",
    "Progress update",
    "Evidence link (optional)",
  ])
    expect(screen.getByLabelText(label).classList).toContain("field__control");
  cleanup();
  render(
    <ContributionDetail
      api={stubApi({
        me: async () => ({
          id: "reader",
          email: "reader@example.test",
          community: null,
        }),
      })}
      id="park"
      client={client()}
    />,
  );
  await user.click(await screen.findByText("Message the organizer"));
  expect(screen.getByLabelText("Private message").classList).toContain(
    "field__control",
  );
});

it("moves focus to the title of a contribution just published", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="park"
      client={client()}
      focusHeading
    />,
  );
  const title = await screen.findByRole("heading", {
    level: 1,
    name: "Make the park accessible",
  });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it("leaves focus alone on a contribution opened any other way", async () => {
  render(<ContributionDetail api={stubApi()} id="park" client={client()} />);
  await screen.findByRole("heading", { level: 1 });
  expect(document.activeElement).toBe(document.body);
});

it("closed contributions can still be contacted and display existing price and fund details", async () => {
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
  expect(
    screen.getByText("Message the organizer").closest("details")?.open,
  ).toBe(false);
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

it("uses load wording for GET failures and save wording for writes", async () => {
  const doFetch = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("{}", { status: 500 }));
  const api = new HttpContributionsApi(doFetch);
  await expect(api.list()).rejects.toThrow("Could not load this. Try again.");
  await expect(api.detail("park")).rejects.toThrow(
    "Could not load this. Try again.",
  );
  await expect(api.messages("park")).rejects.toThrow(
    "Could not load this. Try again.",
  );
  await expect(
    api.create(
      {
        kind: "project",
        title: "Park",
        description: "Fix the park.",
        organizerName: "Ada",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow("Could not save this change. Please try again.");
  await expect(
    api.participate(
      "park",
      { displayName: "Jo", kind: "help", message: "I can help." },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow("Could not save this change. Please try again.");
});

it("says what a refused entry means for each conflict code", async () => {
  const refuse = (error: string) =>
    new HttpContributionsApi(
      async () => new Response(JSON.stringify({ error }), { status: 409 }),
    ).participate(
      "park",
      { displayName: "Jo", kind: "help", message: "I can help." },
      crypto.randomUUID(),
    );
  await expect(refuse("sender_limit")).rejects.toThrow(
    "You have added as many entries to this contribution as one person can.",
  );
  await expect(refuse("closed")).rejects.toThrow(
    "This contribution is closed to new offers of help and pledges.",
  );
  await expect(refuse("record_full")).rejects.toThrow(
    "This contribution has reached its entry limit.",
  );
  await expect(refuse("idempotency_conflict")).rejects.toThrow(
    "This contribution has changed. Reload it before trying again.",
  );
});

it("does not offer retry when a contribution is not found", async () => {
  render(
    <ContributionDetail
      api={stubApi()}
      id="missing"
      client={client({
        detail: async () => {
          throw new ContributionsError(
            404,
            "This contribution could not be found.",
          );
        },
      })}
    />,
  );
  expect(
    await screen.findByText("This contribution could not be found."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.getByRole("link", { name: "← Contributions" })).toBeTruthy();
});

it("publishes a group buy linked to a poll after public confirmation", async () => {
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
  await user.type(
    screen.getByLabelText("Related question (optional)"),
    "https://pulse.example/?poll=garden-poll",
  );
  await user.type(screen.getByLabelText("Title"), "Community tool purchase");
  await user.type(screen.getByLabelText(/Description/), "Buy tools together.");
  await user.type(
    screen.getByLabelText(/Organizer’s public name/),
    "Test organizer",
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(create).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith("park"));
  expect(create.mock.calls[0]?.[0]).toEqual({
    title: "Community tool purchase",
    description: "Buy tools together.",
    organizerName: "Test organizer",
    kind: "group_buy",
    pollId: "garden-poll",
  });
});

it("styles every control on the new contribution form as a shared field", async () => {
  render(
    <NewContribution
      api={stubApi({
        me: async () => ({
          id: "test",
          email: "test@example.test",
          community: null,
        }),
      })}
      client={client()}
      onCreated={vi.fn()}
    />,
  );
  for (const label of [
    "Contribution type",
    "Title",
    "Description",
    "Organizer’s public name",
    "Related question (optional)",
  ])
    expect((await screen.findByLabelText(label)).classList).toContain(
      "field__control",
    );
});

it("refuses a related question that is not a question link or ID, at the field", async () => {
  const create = vi.fn().mockResolvedValue(fixture());
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
      onCreated={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Title"), "Community garden");
  await user.type(screen.getByLabelText("Description"), "Grow food together.");
  await user.type(screen.getByLabelText("Organizer’s public name"), "Ada");
  const related = screen.getByLabelText("Related question (optional)");
  await user.type(related, "https://pulse.example/questions/garden");
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(create).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(related);
  expect(related.getAttribute("aria-invalid")).toBe("true");
  expect(related.getAttribute("aria-describedby")).toContain(
    "contribution-poll-problem",
  );
  expect(
    screen.getByText(
      "This is not a question link or ID. Paste the question’s link, or leave this blank.",
    ),
  ).toBeTruthy();
  await user.clear(related);
  await user.type(related, "garden");
  await user.tab();
  expect(related.getAttribute("aria-invalid")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() =>
    expect(create.mock.calls[0]?.[0]).toMatchObject({ pollId: "garden" }),
  );
});

it("keeps every contribution field after an unknown related poll is rejected", async () => {
  const create = vi
    .fn()
    .mockRejectedValue(
      new ContributionsError(
        404,
        "Check the related question or leave that field blank.",
      ),
    );
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
      onCreated={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Title"), "Community garden");
  await user.type(screen.getByLabelText("Description"), "Grow food together.");
  await user.type(screen.getByLabelText("Organizer’s public name"), "Ada");
  await user.type(
    screen.getByLabelText("Related question (optional)"),
    "missing",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  // One message, beside the field: no second, form-level alert.
  const related = screen.getByLabelText("Related question (optional)");
  await waitFor(() =>
    expect(related.getAttribute("aria-invalid")).toBe("true"),
  );
  expect(
    screen.queryByText("Check the related question or leave that field blank."),
  ).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(related));
  expect(related.getAttribute("aria-invalid")).toBe("true");
  expect(related.getAttribute("aria-describedby")).toContain(
    "contribution-poll-problem",
  );
  expect(
    screen.getByText(
      "We could not find that question. Check the link, or leave this blank.",
    ),
  ).toBeTruthy();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "Community garden",
  );
  expect(
    (screen.getByLabelText("Related question (optional)") as HTMLInputElement)
      .value,
  ).toBe("missing");
});

/** A `me()` the test can switch between accounts, nobody, or offline. */
function switchableMe(start: string | null) {
  const state = { who: start as string | null | "offline" };
  const me = vi.fn(async () => {
    if (state.who === "offline") throw new Error("Offline");
    return state.who === null
      ? null
      : { id: state.who, email: `${state.who}@example.test`, community: null };
  });
  return { state, me };
}
async function writeDrafts(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Public name"), "Jo");
  await user.type(screen.getByLabelText("How you can help"), "Bring tools");
  await user.click(screen.getByText("Message the organizer"));
  await user.type(screen.getByLabelText("Private message"), "Hello there");
}
function draftValues() {
  return [
    (screen.getByLabelText("Public name") as HTMLInputElement).value,
    (screen.getByLabelText("How you can help") as HTMLTextAreaElement).value,
    (screen.getByLabelText("Private message") as HTMLTextAreaElement).value,
  ];
}

it("keeps what was written when the session expires, and sends it after signing in again", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("helper");
  const participate = vi.fn().mockResolvedValue(
    fixture({
      participations: [
        {
          id: "help-1",
          displayName: "Jo",
          kind: "help",
          message: "Bring tools",
          createdAt: "2026-11-15T12:00:00.000Z",
        },
      ],
    }),
  );
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ participate })}
    />,
  );
  await writeDrafts(user);
  // The server no longer knows the session, and no tab announced a sign-out.
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findAllByRole("link", { name: "Sign in again in a new tab" }),
  ).toHaveLength(2);
  expect(draftValues()).toEqual(["Jo", "Bring tools", "Hello there"]);
  // Signing in again as the same person keeps every draft.
  state.who = "helper";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Sign in again in a new tab" }),
    ).toBeNull(),
  );
  expect(draftValues()).toEqual(["Jo", "Bring tools", "Hello there"]);
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  expect(
    await screen.findByText("Thank you. Your entry is on this page."),
  ).toBeTruthy();
  expect(participate).toHaveBeenCalledWith(
    "park",
    { displayName: "Jo", kind: "help", message: "Bring tools" },
    expect.any(String),
  );
});

it("clears what was written when another tab signs out on purpose", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("helper");
  render(
    <ContributionDetail api={stubApi({ me })} id="park" client={client()} />,
  );
  await writeDrafts(user);
  state.who = null;
  window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_OUT_KEY }));
  expect(
    await screen.findByRole("link", {
      name: "Sign in to offer help or make a pledge",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Sign in to send a message" }),
  ).toBeTruthy();
  // Signing back in starts from empty forms.
  state.who = "helper";
  window.dispatchEvent(new Event("focus"));
  expect(await screen.findByLabelText("Public name")).toBeTruthy();
  expect(draftValues()).toEqual(["", "", ""]);
});

it("clears what was written when a different account signs in after an expiry", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("helper");
  render(
    <ContributionDetail api={stubApi({ me })} id="park" client={client()} />,
  );
  await writeDrafts(user);
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  await screen.findAllByRole("link", { name: "Sign in again in a new tab" });
  state.who = "someone-else";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(draftValues()).toEqual(["", "", ""]));
});

it("keeps the page and its drafts when a background reload fails", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe(null);
  const detail = vi
    .fn()
    .mockResolvedValueOnce({ contribution: fixture(), canManage: false })
    .mockResolvedValueOnce({ contribution: fixture(), canManage: false })
    .mockRejectedValue(new ContributionsError(503, "Could not load."));
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ detail })}
    />,
  );
  await screen.findByRole("link", { name: "Sign in to send a message" });
  state.who = "helper";
  window.dispatchEvent(new Event("focus"));
  await writeDrafts(user);
  // Expiry changes the account, which reloads the page; that read fails.
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(3));
  await act(async () => {});
  expect(screen.queryByText("Could not load.")).toBeNull();
  expect(draftValues()).toEqual(["Jo", "Bring tools", "Hello there"]);
});

it("does not let a read that started before a participation undo it", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("helper");
  const entry = {
    id: "help-1",
    displayName: "Jo",
    kind: "help" as const,
    message: "Bring tools",
    createdAt: "2026-11-15T12:00:00.000Z",
  };
  // Reads that start before the participation stay pending until the test
  // lets them answer, and then answer with the older record.
  let written = false;
  const stale: Array<() => void> = [];
  const detail = vi.fn(async () => {
    if (written || detail.mock.calls.length === 1)
      return {
        contribution: fixture(written ? { participations: [entry] } : {}),
        canManage: false,
      };
    return new Promise<{ contribution: Contribution; canManage: boolean }>(
      (resolve) =>
        stale.push(() =>
          resolve({ contribution: fixture(), canManage: false }),
        ),
    );
  });
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({
        detail,
        participate: async () => {
          written = true;
          return fixture({ participations: [entry] });
        },
      })}
    />,
  );
  await screen.findByLabelText("Public name");
  // A switch to another account starts a reload that stays pending...
  state.who = "helper-2";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(stale.length).toBeGreaterThan(0));
  // ...meanwhile that account offers help, and it succeeds...
  await user.type(await screen.findByLabelText("Public name"), "Jo");
  await user.type(screen.getByLabelText("How you can help"), "Bring tools");
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  expect(
    await screen.findByText("Bring tools", { selector: "p" }),
  ).toBeTruthy();
  // ...and the older reads, answering last, do not take the entry away.
  await act(async () => {
    for (const answer of stale) answer();
  });
  await act(async () => {});
  expect(screen.getByText("Bring tools", { selector: "p" })).toBeTruthy();
});

it("keeps an organizer's unsent update through an expired session and same-account sign-in", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("owner");
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({
        detail: async () => ({
          contribution: fixture(),
          canManage: state.who === "owner",
        }),
      })}
    />,
  );
  await user.click(await screen.findByText("Post an update"));
  await user.type(
    screen.getByLabelText("Progress update"),
    "Ramp is half built",
  );
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findAllByRole("link", { name: "Sign in again in a new tab" }),
  ).toHaveLength(2);
  // The private inbox needs a live session; the draft does not.
  expect(screen.queryByText("Private messages", { exact: true })).toBeNull();
  expect(
    (screen.getByLabelText("Progress update") as HTMLTextAreaElement).value,
  ).toBe("Ramp is half built");
  state.who = "owner";
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findByText("Private messages", { exact: true }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Progress update") as HTMLTextAreaElement).value,
  ).toBe("Ramp is half built");
});

it("says when a background reload fails and offers to try again without hiding the page", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe(null);
  let failing = false;
  const detail = vi.fn(async () => {
    if (failing) throw new ContributionsError(503, "Could not load.");
    return { contribution: fixture(), canManage: state.who === "owner" };
  });
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ detail })}
    />,
  );
  const title = await screen.findByRole("heading", { level: 1 });
  failing = true;
  state.who = "owner";
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findByText(/This page could not be brought up to date/),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 })).toBe(title);
  failing = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Post an update")).toBeTruthy();
  // The banner and its button are gone; focus goes to the title, not the page.
  expect(document.activeElement).toBe(title);
  expect(
    screen.queryByText(/This page could not be brought up to date/),
  ).toBeNull();
  expect(screen.getByRole("heading", { level: 1 })).toBe(title);
});

it("puts keyboard focus on the outcome after a send, not on the page", async () => {
  const user = userEvent.setup();
  let finish: () => void = () => {};
  const sendMessage = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ContributionDetail
      api={stubApi({ me: switchableMe("reader").me })}
      id="park"
      client={client({ sendMessage })}
    />,
  );
  await user.click(await screen.findByText("Message the organizer"));
  await user.type(screen.getByLabelText("Private message"), "Hello");
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Send message" }),
  );
  await user.keyboard("{Enter}");
  // A browser drops focus to the page when a focused button becomes
  // disabled; jsdom keeps it there (and will not blur a disabled button), so
  // put focus on the page the way the browser would.
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute("tabindex");
  await act(async () => finish());
  expect(document.activeElement).toBe(
    screen.getByText("Message sent to the organizer."),
  );
});

it("says beside each field what is missing instead of a browser bubble", async () => {
  const user = userEvent.setup();
  const participate = vi.fn(async () => fixture());
  const update = vi.fn(async () => fixture());
  const sendMessage = vi.fn(async () => {});
  render(
    <ContributionDetail
      api={stubApi({ me: switchableMe("owner").me })}
      id="park"
      client={client({
        detail: async () => ({ contribution: fixture(), canManage: true }),
        participate,
        update,
        sendMessage,
      })}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Offer help" }));
  expect(screen.getByText("Enter the name to show.")).toBeTruthy();
  expect(screen.getByText("Say how you can help.")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Public name"));
  // Marked invalid, so they show red and a screen reader says so.
  expect(
    screen.getByLabelText("Public name").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    screen.getByLabelText("How you can help").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(participate).not.toHaveBeenCalled();
  // Fixing a field takes its complaint back straight away.
  await user.type(screen.getByLabelText("Public name"), "Jo");
  expect(screen.queryByText("Enter the name to show.")).toBeNull();
  expect(
    screen.getByLabelText("Public name").getAttribute("aria-invalid"),
  ).toBeNull();
  expect(screen.getByText("Say how you can help.")).toBeTruthy();

  await user.click(screen.getByText("Post an update"));
  await user.type(screen.getByLabelText("Progress update"), "Done");
  await user.type(
    screen.getByLabelText("Evidence link (optional)"),
    "photos/fence",
  );
  await user.click(screen.getByRole("button", { name: "Publish update" }));
  expect(
    screen.getByText("Enter a full link, starting with https://"),
  ).toBeTruthy();
  expect(
    screen.getByText("Confirm this status and update may be published."),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByLabelText("Evidence link (optional)"),
  );
  for (const label of [
    "Evidence link (optional)",
    "I confirm this status and update may be published.",
  ])
    expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe(
      "true",
    );
  expect(
    screen.getByLabelText("Progress update").getAttribute("aria-invalid"),
  ).toBeNull();
  expect(update).not.toHaveBeenCalled();
  await user.click(
    screen.getByLabelText("I confirm this status and update may be published."),
  );
  expect(
    screen.queryByText("Confirm this status and update may be published."),
  ).toBeNull();
  // A link still not a web link keeps its complaint.
  await user.type(screen.getByLabelText("Evidence link (optional)"), "x");
  expect(
    screen.getByText("Enter a full link, starting with https://"),
  ).toBeTruthy();
});

it("forgets a sign-in error once the same person has signed in again", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("helper");
  const participate = vi
    .fn()
    .mockRejectedValue(new ContributionsError(401, "Sign in to continue."));
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ participate })}
    />,
  );
  await user.type(await screen.findByLabelText("Public name"), "Jo");
  await user.type(screen.getByLabelText("How you can help"), "Tools");
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  expect(await screen.findByText("Sign in to continue.")).toBeTruthy();
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  await screen.findAllByRole("link", { name: "Sign in again in a new tab" });
  state.who = "helper";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByText("Sign in to continue.")).toBeNull(),
  );
  expect(
    (screen.getByLabelText("How you can help") as HTMLTextAreaElement).value,
  ).toBe("Tools");
});

it("puts the thank-you away when the person switches to start another entry", async () => {
  const user = userEvent.setup();
  render(
    <ContributionDetail
      api={stubApi({ me: switchableMe("helper").me })}
      id="park"
      client={client()}
    />,
  );
  await user.type(await screen.findByLabelText("Public name"), "Jo");
  await user.type(screen.getByLabelText("How you can help"), "Tools");
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  expect(
    await screen.findByText("Thank you. Your entry is on this page."),
  ).toBeTruthy();
  await user.click(screen.getByLabelText("Make a pledge"));
  expect(
    screen.queryByText("Thank you. Your entry is on this page."),
  ).toBeNull();
});

it("puts the sign-in notice first in the message form and keeps the organizer off their own message form while expired", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("owner");
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({
        detail: async () => ({
          contribution: fixture(),
          canManage: state.who === "owner",
        }),
      })}
    />,
  );
  await user.click(await screen.findByText("Post an update"));
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  expect(
    await screen.findByText("Sign in again to read your private messages."),
  ).toBeTruthy();
  expect(screen.queryByText("Message the organizer")).toBeNull();
});

it("shows the expiry notice above the message form's privacy note", async () => {
  const user = userEvent.setup();
  const { state, me } = switchableMe("reader");
  render(
    <ContributionDetail api={stubApi({ me })} id="park" client={client()} />,
  );
  await user.click(await screen.findByText("Message the organizer"));
  await user.type(screen.getByLabelText("Private message"), "Hi");
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  const form = (await screen.findByLabelText("Private message")).closest(
    "form",
  )!;
  await waitFor(() =>
    expect(form.firstElementChild?.className).toBe("contribution-expired"),
  );
});
