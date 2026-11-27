// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type {
  CreationContext,
  NewPollRequest,
  Poll,
} from "../src/api/types.js";
import { keepDraft, readDraft } from "../src/flow/draft-store.js";
import { emptyDraft } from "../src/flow/new-poll.js";
import {
  NewPoll,
  PUBLIC_VOTES_NOTE,
  VOTE_PRIVACY_NOTE,
} from "../src/screens/NewPoll.js";
import { installDialog } from "./dialog-polyfill.js";
import { poll, stubApi } from "./stub-api.js";
beforeAll(installDialog);

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

/** ADR-0048 step 4b: the poster picks anonymous or public votes, once. */
const CONTEXT: CreationContext = {
  community: { id: "pulse-general", label: "General" },
  canPostUnlimited: false,
  purposeVersion: "community-purpose-v1",
  purposeAcknowledged: true,
};
type Create = (key: string, request: NewPollRequest) => Promise<Poll>;

function show({
  createPoll = vi.fn<Create>(() => Promise.resolve(poll({ id: "new-1" }))),
  restoreDraft = false,
}: { createPoll?: Create; restoreDraft?: boolean } = {}) {
  render(
    <NewPoll
      api={stubApi({
        creationContext: () => Promise.resolve(CONTEXT),
        createPoll,
      })}
      signInHref="/sign-in?next=new"
      onPosted={vi.fn()}
      newKey={() => "key-1"}
      now={() => new Date(2026, 9, 20, 12, 0).getTime()}
      restoreDraft={restoreDraft}
    />,
  );
  return { createPoll };
}

const CHANGE = "Change whether votes are anonymous or public";
const button = (name: string) => screen.getByRole("button", { name });
/** What a screen reader reads as the element's description. */
const describedBy = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
const radio = (name: string) =>
  screen.getByRole<HTMLInputElement>("radio", { name });

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText("Your question"),
    "Should we open a community garden?",
  );
  await user.type(screen.getByLabelText("Choice 1"), "Yes");
  await user.type(screen.getByLabelText("Choice 2"), "No");
}

describe("whether votes are anonymous or public (ADR-0048)", () => {
  it("is anonymous by default, says it is picked once, and sends nothing extra", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    const change = await screen.findByRole("button", { name: CHANGE });
    expect(screen.getByText("Votes are anonymous")).toBeTruthy();
    const note = document.getElementById(
      change.getAttribute("aria-describedby") ?? "",
    );
    expect(note?.textContent).toBe(VOTE_PRIVACY_NOTE);
    expect(VOTE_PRIVACY_NOTE).toBe(
      "You choose this once. It can't be changed after you post.",
    );
    // The setting's words are the vote card's, never attribution's.
    expect(document.body.textContent).not.toMatch(/votes? posted anonymously/i);

    await fill(user);
    await user.click(button("Post question"));
    expect(screen.getByText("Post it? It can't be changed.")).toBeTruthy();
    await user.click(button("Post it"));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1]).not.toHaveProperty(
      "votePrivacy",
    );
  });

  it("opens by keyboard on the current choice and posts a public-vote question", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await fill(user);
    button(CHANGE).focus();
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", {
      name: "Whether votes are anonymous or public",
    });
    expect(group.getAttribute("aria-describedby")).toBe(
      screen.getByText(VOTE_PRIVACY_NOTE).id,
    );
    expect(describedBy(group)).toBe(VOTE_PRIVACY_NOTE);
    expect(document.activeElement).toBe(radio("Votes are anonymous"));
    expect(screen.queryByText(PUBLIC_VOTES_NOTE)).toBeNull();

    // jsdom has no arrow-key radio movement; Space picks the focused one.
    radio("Votes are public").focus();
    await user.keyboard(" ");
    expect(radio("Votes are public").checked).toBe(true);
    expect(screen.getByText(PUBLIC_VOTES_NOTE)).toBeTruthy();
    // Both notes describe the group: the once-note and who sees each answer.
    expect(describedBy(group)).toBe(
      `${VOTE_PRIVACY_NOTE} ${PUBLIC_VOTES_NOTE}`,
    );
    // Arrowing onto the public radio reads who sees each answer too.
    expect(describedBy(radio("Votes are public"))).toContain(PUBLIC_VOTES_NOTE);
    expect(PUBLIC_VOTES_NOTE).toMatch(/sign in with their email to vote/);
    expect(PUBLIC_VOTES_NOTE).toMatch(/including AI apps/);
    expect(PUBLIC_VOTES_NOTE).toMatch(/“Verified voter”/);
    expect(screen.getByText(VOTE_PRIVACY_NOTE)).toBeTruthy();

    await user.click(button("Post question"));
    expect(
      screen.getByText("Post it with public votes? It can't be changed."),
    ).toBeTruthy();
    await user.click(button("Post it"));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1]).toMatchObject({
      question: "Should we open a community garden?",
      votePrivacy: "public",
    });
  });

  it("switching back to anonymous sends the default again", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await fill(user);
    await user.click(button(CHANGE));
    await user.click(radio("Votes are public"));
    await user.click(radio("Votes are anonymous"));
    expect(screen.queryByText(PUBLIC_VOTES_NOTE)).toBeNull();
    await user.click(button("Post question"));
    await user.click(button("Post it"));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1]).not.toHaveProperty(
      "votePrivacy",
    );
  });

  it("shows the server's sentence when public votes are unavailable", async () => {
    const user = userEvent.setup();
    const message =
      "Questions with public votes cannot be posted just now. Try again later.";
    show({
      createPoll: () =>
        Promise.reject(new ApiError(503, message, "public_votes_unavailable")),
    });
    await fill(user);
    await user.click(button(CHANGE));
    await user.click(radio("Votes are public"));
    await user.click(button("Post question"));
    await user.click(button("Post it"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    await waitFor(() => expect(document.activeElement).toBe(button("Post it")));
  });

  it("keeps a public choice across the sign-in a post needed", async () => {
    const user = userEvent.setup();
    show({
      createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await fill(user);
    await user.click(button(CHANGE));
    await user.click(radio("Votes are public"));
    await user.click(button("Post question"));
    await user.click(button("Post it"));
    await screen.findByRole("link", { name: "Sign in to post" });
    cleanup();

    const { createPoll } = show({ restoreDraft: true });
    await screen.findByLabelText("Your question");
    expect(screen.getByText("Votes are public")).toBeTruthy();
    await user.click(button("Post question"));
    await user.click(button("Post it"));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1].question).toBe(
      "Should we open a community garden?",
    );
    expect(vi.mocked(createPoll).mock.calls[0]?.[1]).toHaveProperty(
      "votePrivacy",
      "public",
    );
  });
});

describe("a kept draft's vote setting", () => {
  const store = () => globalThis.localStorage;
  const AT = 1_000;

  it("reads a draft kept before the setting existed as anonymous", () => {
    const old: Partial<ReturnType<typeof emptyDraft>> = emptyDraft();
    delete old.votePrivacy;
    store().setItem(
      "pulse.newPollDraft",
      JSON.stringify({ draft: old, at: AT }),
    );
    expect(readDraft(store(), AT)?.votePrivacy).toBe("anonymous");
  });

  it("drops a draft whose setting is not one this client wrote", () => {
    store().setItem(
      "pulse.newPollDraft",
      JSON.stringify({
        draft: { ...emptyDraft(), votePrivacy: "named" },
        at: AT,
      }),
    );
    expect(readDraft(store(), AT)).toBeNull();
  });

  it("keeps public as public", () => {
    keepDraft({ ...emptyDraft(), votePrivacy: "public" }, store(), AT);
    expect(readDraft(store(), AT)?.votePrivacy).toBe("public");
  });
});
