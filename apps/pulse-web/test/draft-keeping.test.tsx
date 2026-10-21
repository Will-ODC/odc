// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ApiError } from "../src/api/types.js";
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

  it("does not give a prior person's draft to someone signing in after an ordinary signed-out visit", async () => {
    globalThis.history.replaceState(null, "", "/new");
    const first = render(
      <App
        api={stubApi({
          creationContext: () => Promise.resolve(CONTEXT),
          createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
        })}
      />,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Your question"),
      KEPT.question,
    );
    await user.type(screen.getByLabelText("Choice 1"), KEPT.choices[0]!);
    await user.type(screen.getByLabelText("Choice 2"), KEPT.choices[1]!);
    await user.click(screen.getByRole("button", { name: "Post question" }));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await screen.findByText(
      /Your question was not posted. What you wrote is kept/,
    );
    first.unmount();

    // A fresh /new visit has no connection to the previous person's form.
    const ordinary = render(
      <App
        api={stubApi({
          creationContext: () =>
            Promise.reject(new ApiError(401, "Sign in first.")),
        })}
      />,
    );
    const href = (
      await screen.findByRole("link", { name: "Sign in to post" })
    ).getAttribute("href")!;
    ordinary.unmount();

    globalThis.history.replaceState(null, "", href);
    const signIn = render(<App api={stubApi()} />);
    await screen.findByLabelText("Your email");
    signIn.unmount();

    globalThis.history.replaceState(null, "", "/sign-in?token=abc123");
    render(
      <App
        api={stubApi({
          redeem: () =>
            Promise.resolve({ ...ME, id: "v2", email: "next@example.org" }),
          creationContext: () => Promise.resolve(CONTEXT),
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await question()).toBe("");
    expect(globalThis.localStorage.getItem("pulse.newPollDraft")).toBeNull();
  });

  it.each(["loading", "error"])(
    "forgets a prior draft while an ordinary visit is %s",
    async (state) => {
      keepDraft(KEPT, globalThis.localStorage);
      globalThis.history.replaceState(null, "", "/new");
      render(
        <App
          api={stubApi({
            creationContext: () =>
              state === "loading"
                ? new Promise(() => {})
                : Promise.reject(
                    new ApiError(503, "Posting is not available right now."),
                  ),
          })}
        />,
      );
      if (state === "loading")
        expect(screen.getByText("Loading…")).toBeTruthy();
      else await screen.findByText("Posting is not available right now.");
      expect(globalThis.localStorage.getItem("pulse.newPollDraft")).toBeNull();
    },
  );

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
