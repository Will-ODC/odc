// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContributionDetail } from "../src/screens/ContributionDetail.js";
import { ContributionsError } from "../src/api/contributions.js";
import { stubApi } from "./stub-api.js";
import {
  contributionFixture as fixture,
  stubContributionsApi as client,
  switchableMe,
} from "./contributions-fixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["help", "pledge", "message", "update"] as const)(
  "clears a refused %s draft before a pending session recheck resolves",
  async (form) => {
    const ada = { id: "ada", email: "ada@example.test", community: null };
    const bea = { id: "bea", email: "bea@example.test", community: null };
    let oldAnswer!: (value: typeof ada) => void;
    let newAnswer!: (value: typeof ada) => void;
    const me = vi
      .fn()
      .mockResolvedValueOnce(ada)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldAnswer = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            newAnswer = resolve;
          }),
      );
    const refused = new ContributionsError(
      409,
      "Your account changed, so this wasn't sent.",
      "account_changed",
    );
    const participate = vi.fn().mockRejectedValue(refused);
    const sendMessage = vi.fn().mockRejectedValue(refused);
    const update = vi.fn().mockRejectedValue(refused);
    render(
      <ContributionDetail
        api={stubApi({ me })}
        id="park"
        client={client({
          detail: async () => ({
            contribution: fixture(),
            canManage: form === "update",
          }),
          participate,
          sendMessage,
          update,
        })}
      />,
    );
    const user = userEvent.setup();
    await screen.findByLabelText("Public name");
    let label: string;
    let button: string;
    if (form === "message") {
      await user.click(screen.getByText("Message the organizer"));
      label = "Private message";
      button = "Send message";
    } else if (form === "update") {
      await user.click(await screen.findByText("Post an update"));
      label = "Progress update";
      button = "Publish update";
      await user.click(
        screen.getByLabelText(
          "I confirm this status and update may be published.",
        ),
      );
      await user.selectOptions(
        screen.getByLabelText("Current status"),
        "completed",
      );
    } else {
      await user.type(screen.getByLabelText("Public name"), "Ada");
      if (form === "pledge")
        await user.click(screen.getByRole("radio", { name: "Make a pledge" }));
      label = form === "help" ? "How you can help" : "What you pledge";
      button = form === "help" ? "Offer help" : "Make pledge";
    }
    await user.type(screen.getByLabelText(label), "Draft written by Ada");
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: button }));
    const notice = `Your account changed, so ${
      form === "message"
        ? "your message"
        : form === "update"
          ? "your update"
          : "your entry"
    } wasn't sent.`;
    const alert = await screen.findByText(notice);
    // The button pressed went with the emptied form: focus is on the notice.
    expect(document.activeElement).toBe(alert);
    expect(alert.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(me).toHaveBeenCalledTimes(3));
    const send =
      form === "message"
        ? sendMessage
        : form === "update"
          ? update
          : participate;
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[3]).toBe("ada");
    // Remount immediately, while both /me answers are still pending.
    const emptyLabel = form === "pledge" ? "How you can help" : label;
    expect(
      (screen.getByLabelText(emptyLabel) as HTMLTextAreaElement).value,
    ).toBe("");
    if (form === "update") {
      expect(
        (
          screen.getByLabelText(
            "I confirm this status and update may be published.",
          ) as HTMLInputElement
        ).checked,
      ).toBe(false);
      expect(
        (screen.getByLabelText("Current status") as HTMLSelectElement).value,
      ).toBe("open");
    }
    await act(async () => {
      newAnswer(bea);
    });
    await act(async () => {
      oldAnswer(ada);
    });
    expect(screen.queryByDisplayValue("Draft written by Ada")).toBeNull();
    expect(
      screen.queryByText(
        /Your .* has been published|Message sent to the organizer/,
      ),
    ).toBeNull();
    // The account the recheck found is the change the notice is about.
    expect(screen.getByText(notice)).toBe(alert);
    expect(document.activeElement).toBe(alert);
    if (form === "message") expect(alert.closest("details")?.open).toBe(true);

    // Bea writes again: the notice goes on her first edit, and her send
    // shows only its own outcome.
    send.mockResolvedValue(form === "message" ? undefined : fixture());
    if (form === "help" || form === "pledge")
      await user.type(await screen.findByLabelText("Public name"), "Bea");
    else await user.type(await screen.findByLabelText(label), "B");
    expect(screen.queryByText(notice)).toBeNull();
    if (form === "pledge")
      await user.click(screen.getByRole("radio", { name: "Make a pledge" }));
    if (form === "update")
      await user.click(
        screen.getByLabelText(
          "I confirm this status and update may be published.",
        ),
      );
    await user.type(screen.getByLabelText(label), "Bea's entry");
    await user.click(screen.getByRole("button", { name: button }));
    expect(
      await screen.findByText(
        form === "message"
          ? "Message sent to the organizer."
          : form === "update"
            ? "Your update has been published."
            : "Thank you. Your entry is on this page.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(notice)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[3]).toBe("bea");
  },
);

it("puts the refusal notice away for a later switch once the recheck finds the same account (#610)", async () => {
  const { state, me } = switchableMe("ada");
  const participate = vi
    .fn()
    .mockRejectedValue(
      new ContributionsError(
        409,
        "Your account changed, so this wasn't sent.",
        "account_changed",
      ),
    );
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ participate })}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Public name"), "Ada");
  await user.type(screen.getByLabelText("How you can help"), "Tools");
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  const notice = "Your account changed, so your entry wasn't sent.";
  expect(await screen.findByText(notice)).toBeTruthy();
  // The recheck finds Ada again: nothing changed.
  await waitFor(() => expect(me.mock.calls.length).toBeGreaterThan(1));
  await act(async () => {});
  expect(screen.getByText(notice)).toBeTruthy();
  // A switch afterwards is not the change the notice was about.
  state.who = "bea";
  await act(async () => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(screen.queryByText(notice)).toBeNull());
});

it("keeps each refused form's notice when another form is edited before the recheck answers (#610)", async () => {
  const ada = { id: "ada", email: "ada@example.test", community: null };
  const bea = { id: "bea", email: "bea@example.test", community: null };
  const answers: ((value: typeof ada) => void)[] = [];
  const me = vi
    .fn()
    .mockResolvedValueOnce(ada)
    .mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  const refused = new ContributionsError(
    409,
    "Your account changed, so this wasn't sent.",
    "account_changed",
  );
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({
        participate: vi.fn().mockRejectedValue(refused),
        sendMessage: vi.fn().mockRejectedValue(refused),
      })}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Public name"), "Ada");
  await user.type(screen.getByLabelText("How you can help"), "Tools");
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  const entry = "Your account changed, so your entry wasn't sent.";
  const message = "Your account changed, so your message wasn't sent.";
  expect(await screen.findByText(entry)).toBeTruthy();
  await user.click(screen.getByText("Message the organizer"));
  await user.type(screen.getByLabelText("Private message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText(message)).toBeTruthy();
  // The entry form is edited while the rechecks are still out.
  await user.type(screen.getByLabelText("Public name"), "B");
  expect(screen.queryByText(entry)).toBeNull();
  // The recheck finds Bea: the message form's notice is about her.
  await act(async () => answers.forEach((answer) => answer(bea)));
  await act(async () => {});
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText(entry)).toBeNull();
});

it("puts the refusal notice away when another account replaces the one it was about", async () => {
  const { state, me } = switchableMe("ada");
  const participate = vi
    .fn()
    .mockRejectedValue(
      new ContributionsError(
        409,
        "Your account changed, so this wasn't sent.",
        "account_changed",
      ),
    );
  render(
    <ContributionDetail
      api={stubApi({ me })}
      id="park"
      client={client({ participate })}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Public name"), "Ada");
  await user.type(screen.getByLabelText("How you can help"), "Tools");
  state.who = "bea";
  await user.click(screen.getByRole("button", { name: "Offer help" }));
  const notice = "Your account changed, so your entry wasn't sent.";
  expect(await screen.findByText(notice)).toBeTruthy();
  // The recheck finds Bea: the notice stays for her empty form.
  await waitFor(() => expect(me.mock.calls.length).toBeGreaterThan(1));
  await act(async () => {});
  expect(screen.getByText(notice)).toBeTruthy();
  // A later switch to yet another account is not what it was about.
  state.who = "cy";
  await act(async () => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(screen.queryByText(notice)).toBeNull());
});

it.each(["help", "pledge", "message", "update"] as const)(
  "keeps the new account's %s draft when the old account's refusal arrives late",
  async (form) => {
    const { state, me } = switchableMe("ada");
    let refuse!: (reason: Error) => void;
    const send = vi.fn<(...args: unknown[]) => Promise<never>>(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    render(
      <ContributionDetail
        api={stubApi({ me })}
        id="park"
        client={client({
          detail: async () => ({
            contribution: fixture(),
            canManage: form === "update",
          }),
          participate: send,
          sendMessage: send,
          update: send,
        })}
      />,
    );
    const user = userEvent.setup();
    await screen.findByLabelText("Public name");
    const label = {
      help: "How you can help",
      pledge: "What you pledge",
      message: "Private message",
      update: "Progress update",
    }[form];
    const button = {
      help: "Offer help",
      pledge: "Make pledge",
      message: "Send message",
      update: "Publish update",
    }[form];
    async function openForm() {
      if (form === "message" || form === "update") {
        const summary = await screen.findByText(
          form === "message" ? "Message the organizer" : "Post an update",
        );
        if (!summary.closest("details")!.open) await user.click(summary);
        if (form === "update")
          await user.click(
            screen.getByLabelText(
              "I confirm this status and update may be published.",
            ),
          );
      } else {
        await user.type(screen.getByLabelText("Public name"), state.who!);
        if (form === "pledge")
          await user.click(
            screen.getByRole("radio", { name: "Make a pledge" }),
          );
      }
    }
    await openForm();
    await user.type(screen.getByLabelText(label), "Ada's old draft");
    await user.click(screen.getByRole("button", { name: button }));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[3]).toBe("ada");

    state.who = "bea";
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Ada's old draft")).toBeNull(),
    );
    await openForm();
    await user.type(screen.getByLabelText(label), "Bea's new draft");
    const rechecks = me.mock.calls.length;
    await act(async () => {
      refuse(
        new ContributionsError(
          409,
          "Your account changed, so this wasn't sent.",
          "account_changed",
        ),
      );
    });
    await waitFor(() => expect(me.mock.calls.length).toBeGreaterThan(rechecks));
    expect((screen.getByLabelText(label) as HTMLTextAreaElement).value).toBe(
      "Bea's new draft",
    );
    expect(screen.queryByText(/Your account changed/)).toBeNull();
  },
);
