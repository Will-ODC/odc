// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { keepDraft } from "../src/flow/draft-store.js";
import { emptyDraft } from "../src/flow/new-poll.js";
import { Conversation } from "../src/screens/Conversation.js";
import { stubApi } from "./stub-api.js";

/*
 * Who sees a posting draft kept across a sign-in (#393 review): only the way
 * back from a sign-in started on the form, and nobody after a sign-out.
 */
const ME = { id: "v1", email: "jo@student.ubc.ca", community: "ubc" };
const CONTEXT = {
  community: { id: "pulse-general", label: "General" },
  canPostUnlimited: false,
  purposeVersion: "community-purpose-v1",
  purposeAcknowledged: true,
};
const KEPT = {
  ...emptyDraft(),
  question: "Kept question?",
  choices: ["a", "b"],
};

beforeEach(() => {
  globalThis.history.replaceState(null, "", "/");
  globalThis.localStorage.clear();
});
afterEach(cleanup);

const question = async () =>
  ((await screen.findByLabelText("Your question")) as HTMLTextAreaElement)
    .value;

describe("a kept draft", () => {
  it("comes back on the way back from a sign-in started on the form", async () => {
    keepDraft(KEPT, globalThis.localStorage);
    globalThis.history.replaceState(null, "", "/sign-in?next=new");
    const first = render(<App api={stubApi()} />);
    await screen.findByLabelText("Your email");
    first.unmount();

    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(
      <App
        api={stubApi({
          redeem: () => Promise.resolve(ME),
          creationContext: () => Promise.resolve(CONTEXT),
        })}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );
    expect(await question()).toBe("Kept question?");
  });

  it("does not come back when /new is simply opened", async () => {
    keepDraft(KEPT, globalThis.localStorage);
    globalThis.history.replaceState(null, "", "/new");
    render(
      <App
        api={stubApi({ creationContext: () => Promise.resolve(CONTEXT) })}
      />,
    );
    expect(await question()).toBe("");
    expect(globalThis.localStorage.getItem("pulse.newPollDraft")).toBeNull();
  });

  it("is forgotten when someone signs out", async () => {
    keepDraft(KEPT, globalThis.localStorage);
    const signOut = vi.fn(() => Promise.resolve());
    render(
      <Conversation
        api={stubApi({ me: () => Promise.resolve(ME), signOut })}
        pollId="ads-free"
      />,
    );
    const user = userEvent.setup();
    const bar = within(await screen.findByRole("banner"));
    await user.click(await bar.findByRole("button", { name: "Sign out" }));
    await user.click(bar.getByRole("button", { name: "Sign out everywhere" }));
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(globalThis.localStorage.getItem("pulse.newPollDraft")).toBeNull(),
    );
  });
});
