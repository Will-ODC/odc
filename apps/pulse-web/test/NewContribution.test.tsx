// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionsError } from "../src/api/contributions.js";
import type {
  Contribution,
  ContributionsApi,
} from "../src/api/contributions.js";
import { NewContribution } from "../src/screens/NewContribution.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
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
  sendMessage: async () => {},
  messages: async () => [],
  detail: async () => ({ contribution: fixture(), canManage: false }),
  create: async () => fixture(),
  participate: async () => fixture(),
  update: async () => fixture(),
  ...over,
});

function setup() {
  const state = { who: "ada" as string | null };
  const me = vi.fn(async () =>
    state.who === null
      ? null
      : { id: state.who, email: `${state.who}@example.test`, community: null },
  );
  const create = vi.fn().mockResolvedValue(fixture());
  const signOut = vi.fn(async () => {
    state.who = null;
  });
  render(
    <NewContribution
      api={stubApi({ me, signOut })}
      client={client({ create })}
      onCreated={vi.fn()}
    />,
  );
  return { state, create, user: userEvent.setup() };
}
async function writeDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Title"), "Garden");
  await user.type(screen.getByLabelText("Description"), "Grow food.");
  await user.type(screen.getByLabelText("Organizer’s public name"), "Ada");
  await user.type(
    screen.getByLabelText("Related question (optional)"),
    "garden",
  );
  await user.selectOptions(
    screen.getByLabelText("Contribution type"),
    "group_buy",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I confirm this post/ }),
  );
}
function expectDraft(empty = false) {
  for (const [label, value] of [
    ["Title", "Garden"],
    ["Description", "Grow food."],
    ["Organizer’s public name", "Ada"],
    ["Related question (optional)", "garden"],
  ]) {
    expect((screen.getByLabelText(label!) as HTMLInputElement).value).toBe(
      empty ? "" : value,
    );
  }
  expect(
    (screen.getByLabelText("Contribution type") as HTMLSelectElement).value,
  ).toBe(empty ? "project" : "group_buy");
  expect(
    (
      screen.getByRole("checkbox", {
        name: /I confirm this post/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(!empty);
}

it.each(["here", "elsewhere"])(
  "clears the draft and confirmation after deliberate sign-out %s",
  async (where) => {
    const { state, user, create } = setup();
    await writeDraft(user);
    if (where === "here") {
      await user.click(screen.getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await user.click(
        screen.getByRole("button", { name: "Sign out everywhere" }),
      );
    } else {
      state.who = null;
      window.dispatchEvent(
        new StorageEvent("storage", { key: SIGNED_OUT_KEY }),
      );
    }
    expect(
      await screen.findByRole("heading", { name: "Sign in to get started" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
    state.who = "ada";
    window.dispatchEvent(new Event("focus"));
    await screen.findByLabelText("Title");
    expectDraft(true);
    expect(create).not.toHaveBeenCalled();
  },
);

it("keeps the draft and confirmation through expiry and the same account signing back in", async () => {
  const { state, user, create } = setup();
  await writeDraft(user);
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  const link = await screen.findByRole("link", {
    name: "Sign in again in a new tab",
  });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("href")).toBe("/sign-in?next=contribution-new");
  const notice = link.closest("p")!;
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.className).toBe("contribution-expired");
  expect(notice.textContent).toBe(
    "Your sign-in has ended. What you wrote stays here. Sign in again in a new tab to send it.",
  );
  expect(notice.closest("form")?.firstElementChild).toBe(notice);
  expect(link.getAttribute("rel")).toBe("noreferrer");
  expectDraft();
  expect(
    (
      screen.getByRole("button", {
        name: "Publish contribution",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  state.who = "ada";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByText("Sign in again in a new tab")).toBeNull(),
  );
  expectDraft();
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
});

it("hides a failed Publish during expiry and clears it when the same account returns", async () => {
  const { state, user, create } = setup();
  create.mockRejectedValueOnce(new Error("Connection lost. Please try again."));
  await writeDraft(user);
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Connection lost. Please try again.",
  );
  state.who = null;
  window.dispatchEvent(new Event("focus"));
  await screen.findByRole("link", { name: "Sign in again in a new tab" });
  expect(screen.queryByRole("alert")).toBeNull();
  expectDraft();
  state.who = "ada";
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Publish contribution",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expectDraft();
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
});

it.each([false, true])(
  "clears the draft when another account signs in (after expiry: %s)",
  async (expired) => {
    const { state, user, create } = setup();
    await writeDraft(user);
    if (expired) {
      state.who = null;
      window.dispatchEvent(new Event("focus"));
      await screen.findByRole("link", { name: "Sign in again in a new tab" });
    }
    state.who = "bea";
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
        "",
      ),
    );
    expectDraft(true);
    expect(create).not.toHaveBeenCalled();
  },
);

it("shows every missing field inline and focuses the first on empty Publish", async () => {
  const { user, create } = setup();
  const title = await screen.findByLabelText("Title");
  expect(title.closest("form")?.noValidate).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  for (const label of ["Title", "Description", "Organizer’s public name"]) {
    const control = screen.getByLabelText(label);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const problemId = control
      .getAttribute("aria-describedby")
      ?.split(" ")
      .pop();
    expect(document.getElementById(problemId!)?.className).toBe(
      "field__problem",
    );
  }
  expect(screen.getByText("Enter a title.")).toBeTruthy();
  expect(screen.getByText("Enter a description.")).toBeTruthy();
  expect(screen.getByText("Enter the organizer’s public name.")).toBeTruthy();
  expect(
    screen.getByText("Confirm that this post may be published."),
  ).toBeTruthy();
  expect(document.activeElement).toBe(title);
  expect(create).not.toHaveBeenCalled();
});

it.each(["Title", "Description", "Organizer’s public name"])(
  "rejects whitespace in %s, keeping other entries and validating on blur",
  async (label) => {
    const { user, create } = setup();
    await writeDraft(user);
    const control = screen.getByLabelText(label);
    await user.clear(control);
    await user.type(control, "   ");
    await user.click(
      screen.getByRole("button", { name: "Publish contribution" }),
    );
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(create).not.toHaveBeenCalled();
    await user.clear(control);
    const original =
      label === "Title"
        ? "Garden"
        : label === "Description"
          ? "Grow food."
          : "Ada";
    await user.type(control, original);
    await user.tab();
    expect(control.getAttribute("aria-invalid")).toBeNull();
    expectDraft();
    await user.click(
      screen.getByRole("button", { name: "Publish contribution" }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
  },
);

it("requires inline publication confirmation and keeps the draft", async () => {
  const { user, create } = setup();
  await writeDraft(user);
  const confirm = screen.getByRole("checkbox", { name: /I confirm this post/ });
  await user.click(confirm);
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(document.activeElement).toBe(confirm);
  expect(confirm.getAttribute("aria-invalid")).toBe("true");
  expect(
    screen.getByText("Confirm that this post may be published."),
  ).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
  await user.click(confirm);
  await user.tab();
  expect(confirm.getAttribute("aria-invalid")).toBeNull();
  expectDraft();
});

it("focuses the first missing field before an invalid related question", async () => {
  const { user, create } = setup();
  const title = await screen.findByLabelText("Title");
  const poll = screen.getByLabelText("Related question (optional)");
  await user.type(poll, "https://pulse.example/questions/garden");
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  expect(document.activeElement).toBe(title);
  expect(poll.getAttribute("aria-invalid")).toBe("true");
  expect((poll as HTMLInputElement).value).toBe(
    "https://pulse.example/questions/garden",
  );
  expect(create).not.toHaveBeenCalled();
});

it.each([503, 401, undefined])(
  "focuses the outcome after a deferred keyboard submission fails (%s)",
  async (status) => {
    const { user, create } = setup();
    let reject!: (reason: Error) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await writeDraft(user);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Publish contribution" }),
    );
    await user.keyboard("{Enter}");
    expect(create).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Publishing…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
    expect(document.activeElement).toBe(document.body);
    reject(
      status === undefined
        ? new Error("Connection lost. Try again.")
        : new ContributionsError(status, "Could not publish. Try again."),
    );
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(alert.getAttribute("tabindex")).toBe("-1");
    expectDraft();
    if (status === 401) {
      const notice = screen.getByRole("status");
      expect(notice.textContent).toBe(
        "Your sign-in has ended. What you wrote stays here. Sign in again in a new tab to send it.",
      );
      expect(notice.closest("form")?.firstElementChild).toBe(notice);
    }
  },
);

it("shows a rejected related question only beside the field and focuses it", async () => {
  const { user, create } = setup();
  create.mockRejectedValueOnce(
    new ContributionsError(
      404,
      "Check the related question or leave that field blank.",
    ),
  );
  await writeDraft(user);
  await user.click(
    screen.getByRole("button", { name: "Publish contribution" }),
  );
  const poll = screen.getByLabelText("Related question (optional)");
  await waitFor(() => expect(document.activeElement).toBe(poll));
  expect(poll.getAttribute("aria-invalid")).toBe("true");
  expect(
    screen.getByText(
      "We could not find that question. Check the link, or leave this blank.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.queryByText("Check the related question or leave that field blank."),
  ).toBeNull();
  expectDraft();
});
