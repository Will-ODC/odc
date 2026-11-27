// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import { ContributionsError } from "../src/api/contributions.js";
import type { Contribution } from "../src/api/contributions.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
  switchableMe,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    "reader",
  );
  expect(sendMessage.mock.calls[0]?.[2]).toBe(sendMessage.mock.calls[1]?.[2]);
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
    "helper",
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
    "helper",
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
