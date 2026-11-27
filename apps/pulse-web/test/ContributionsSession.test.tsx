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
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import { ContributionsError } from "../src/api/contributions.js";
import type { Me } from "../src/api/types.js";
import { stubApi } from "./stub-api.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
  switchableMe,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    expect(
      screen.queryByText("Private messages", { selector: "summary" }),
    ).toBeNull(),
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
  expect(
    screen.queryByText("Private messages", { selector: "summary" }),
  ).toBeNull();
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
  expect(
    screen.queryByText("Private messages", { selector: "summary" }),
  ).toBeNull();
  // Still their own post: no "Message the organizer" form in its place.
  expect(screen.getByText(/to read your private messages\./)).toBeTruthy();
  expect(screen.queryByText("Message the organizer")).toBeNull();
});

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
    "helper",
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
  ).toHaveLength(3); // the two expired forms and the private-messages note
  // The private inbox needs a live session; the draft does not.
  expect(
    screen.queryByText("Private messages", { selector: "summary" }),
  ).toBeNull();
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

it("forgets a sign-in error once the same person has signed in again", async () => {
  const user = userEvent.setup();
  const helper = {
    id: "helper",
    email: "helper@example.test",
    community: null,
  };
  let replySignedOut!: (value: null) => void;
  let replySignedIn!: (value: Me) => void;
  const me = vi
    .fn<() => Promise<Me | null>>()
    .mockResolvedValueOnce(helper)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          replySignedOut = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          replySignedIn = resolve;
        }),
    );
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
  window.dispatchEvent(new Event("focus"));
  await act(async () => replySignedOut(null));
  // The 401 already offered a sign-in link. Wait for the expiry notice.
  const expired = await screen.findByText(/Your sign-in has ended/, {
    selector: '[role="status"]',
  });
  expect(
    within(expired).getByRole("link", { name: "Sign in again in a new tab" }),
  ).toBeTruthy();
  expect(screen.getByText("Sign in to continue.")).toBeTruthy();

  window.dispatchEvent(new Event("focus"));
  await act(async () => replySignedIn(helper));
  expect(await screen.findByText(helper.email)).toBeTruthy();
  expect(screen.queryByText("Sign in to continue.")).toBeNull();
  expect(
    (screen.getByLabelText("How you can help") as HTMLTextAreaElement).value,
  ).toBe("Tools");
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
    await screen.findByText(/to read your private messages\./),
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

it("gives an organizer whose sign-in ended a heading and a sign-in link for their messages", async () => {
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
    await screen.findByRole("heading", { name: "Private messages" }),
  ).toBeTruthy();
  const [link, ...others] = screen
    .getAllByRole("link", { name: "Sign in again in a new tab" })
    .filter((a) =>
      a.closest("p")?.textContent?.includes("to read your private messages"),
    );
  expect(others).toHaveLength(0);
  expect(link?.getAttribute("href")).toBe("/sign-in?contribution=park");
  expect(link?.getAttribute("target")).toBe("_blank");
});
