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
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type {
  CreationContext,
  NewPollRequest,
  Poll,
} from "../src/api/types.js";
import { ANONYMITY_NOTE, NewPoll } from "../src/screens/NewPoll.js";
import { poll, stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const FIRST: CreationContext = {
  community: { id: "pulse-general", label: "General" },
  canPostUnlimited: false,
  purposeVersion: "community-purpose-v1",
  purposeAcknowledged: false,
};
const LATER: CreationContext = { ...FIRST, purposeAcknowledged: true };
const NOW = new Date(2026, 9, 20, 12, 0).getTime();

type Create = (key: string, request: NewPollRequest) => Promise<Poll>;

function show({
  context = () => Promise.resolve(FIRST),
  createPoll = vi.fn<Create>(() => Promise.resolve(poll({ id: "new-1" }))),
  keys = ["key-1", "key-2", "key-3"],
  now = () => NOW,
  restoreDraft = false,
}: {
  context?: () => Promise<CreationContext>;
  createPoll?: Create;
  keys?: string[];
  now?: () => number;
  restoreDraft?: boolean;
} = {}) {
  const onPosted = vi.fn();
  const queue = [...keys];
  render(
    <NewPoll
      api={stubApi({ creationContext: context, createPoll })}
      signInHref="/sign-in?next=new"
      onPosted={onPosted}
      newKey={() => queue.shift() ?? "spare"}
      now={now}
      restoreDraft={restoreDraft}
    />,
  );
  return { onPosted, createPoll };
}

const field = (name: string) => screen.getByRole("textbox", { name });
const button = (name: string) => screen.getByRole("button", { name });

/** Fills a valid question, by keyboard only. */
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText("Your question"));
  await user.keyboard("Should we open a community garden?");
  await user.tab();
  await user.keyboard("Yes");
  await user.tab(); // to choice 2 (no Remove buttons while there are two)
  await user.keyboard("No");
}

describe("the four states", () => {
  it("says it is loading, then shows the form with where it posts", async () => {
    show();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Post a question", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("General")).toBeTruthy();
  });

  it("offers sign-in, coming back here, to someone signed out", async () => {
    show({
      context: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    const link = await screen.findByRole("link", { name: "Sign in to post" });
    expect(link.getAttribute("href")).toBe("/sign-in?next=new");
    expect(screen.queryByLabelText("Your question")).toBeNull();
  });

  it("says what went wrong, and asks again on Try again", async () => {
    const context = vi
      .fn<() => Promise<CreationContext>>()
      .mockRejectedValueOnce(
        new ApiError(503, "Posting is not available right now."),
      )
      .mockResolvedValue(LATER);
    show({ context });
    expect(
      await screen.findByText("Posting is not available right now."),
    ).toBeTruthy();
    await userEvent.click(button("Try again"));
    expect(await screen.findByLabelText("Your question")).toBeTruthy();
    expect(context).toHaveBeenCalledTimes(2);
  });

  it("says a dropped connection plainly", async () => {
    show({ context: () => Promise.reject(new TypeError("fetch failed")) });
    expect(
      await screen.findByText(
        "We could not reach pulse. Check your connection and try again.",
      ),
    ).toBeTruthy();
  });
});

describe("the purpose promise (ADR-0037)", () => {
  it("shows the statement and an unchecked promise on a first post", async () => {
    show();
    expect(
      await screen.findByRole("heading", {
        name: "What this discussion is for",
      }),
    ).toBeTruthy();
    const promise = screen.getByRole("checkbox", {
      name: "I will discuss ideas without attacking, harassing or threatening people.",
    }) as HTMLInputElement;
    expect(promise.checked).toBe(false);
    expect(
      screen.getByText(/Comments help us turn ideas into action/),
    ).toBeTruthy();
    expect(screen.queryByText(/Help us move forward/)).toBeNull();
  });

  it("shows only the reminder on later posts", async () => {
    show({ context: () => Promise.resolve(LATER) });
    expect(
      await screen.findByText(
        "Be honest. Respect people. Help us move forward.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("will not ask to post a first post until the promise is ticked", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await fill(user);
    await user.click(button("Post question"));
    expect(
      screen.getByText("Tick the promise to post your question."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    expect(screen.queryByText("Post it? It can't be changed.")).toBeNull();
    expect(createPoll).not.toHaveBeenCalled();
  });
});

/*
 * As simple and fast as possible (operator): question, choices and Post are
 * all that is open. Each default is one line until Change opens it in place.
 */
describe("one screen, defaults in one line", () => {
  it("opens with only the question, the choices and Post", async () => {
    show({ context: () => Promise.resolve(LATER) });
    await screen.findByLabelText("Your question");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByLabelText("Closing time")).toBeNull();
    expect(screen.queryByLabelText("Name to show")).toBeNull();
    expect(screen.getByText("People pick one choice")).toBeTruthy();
    expect(
      screen.getByText(/^Closes in seven days, on Oct 27, 2026/),
    ).toBeTruthy();
    expect(screen.getByText("Posted anonymously")).toBeTruthy();
    expect(button("Post question")).toBeTruthy();
    // No separate review step.
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("opens each setting in place, with focus on its current choice", async () => {
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER) });
    await screen.findByLabelText("Your question");
    await user.click(button("Change how people answer"));
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "One choice" }),
    );
    await user.click(
      screen.getByRole("radio", { name: "Any number of choices" }),
    );
    expect(
      (
        screen.getByRole("radio", {
          name: "Any number of choices",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await user.click(button("Change when it closes"));
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: /^In seven days/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Change how people answer" }),
    ).toBeNull();
  });
});

describe("who readers see (ADR-0037)", () => {
  it("is anonymous by default, with the interim wording beside it", async () => {
    show();
    const change = await screen.findByRole("button", {
      name: "Change who readers see as the poster",
    });
    const note = document.getElementById(
      change.getAttribute("aria-describedby") ?? "",
    );
    expect(note?.textContent).toBe(ANONYMITY_NOTE);
    expect(ANONYMITY_NOTE).toBe(
      "Your name is hidden from other readers. Pulse keeps your account linked to this post to address abuse.",
    );
    // Not the moderator wording: no moderator access exists yet.
    expect(document.body.textContent).not.toMatch(/moderator/i);
    await userEvent.click(change);
    const anonymous = screen.getByRole("radio", {
      name: "Nobody: post anonymously",
    }) as HTMLInputElement;
    expect(anonymous.checked).toBe(true);
    const group = screen.getByRole("group", {
      name: "Who readers see as the poster",
    });
    expect(group.getAttribute("aria-describedby")).toBe(note?.id);
    expect(screen.getByText(ANONYMITY_NOTE)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Name to show" })).toBeNull();
  });

  it("asks for a name, says it is unchecked, and posts under it", async () => {
    const user = userEvent.setup();
    const { createPoll } = show({ context: () => Promise.resolve(LATER) });
    await fill(user);
    await user.click(button("Change who readers see as the poster"));
    await user.click(screen.getByRole("radio", { name: "A name I choose" }));
    expect(screen.getByText(/Pulse does not check it/).textContent).toContain(
      "readers cannot tell whether it is your real name",
    );
    await user.click(button("Post question"));
    expect(
      screen.getByText("Write the name to show, or post anonymously."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(field("Name to show"));
    await user.type(field("Name to show"), " Ada ");
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1].attribution).toEqual({
      kind: "named",
      name: "Ada",
    });
  });
});

describe("choices", () => {
  it("adds up to 25, focuses each new one, and removes the 25th", async () => {
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER) });
    await screen.findByLabelText("Your question");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    const addChoice = button("Add a choice");
    for (let n = 3; n <= 25; n += 1) {
      await user.click(addChoice);
      expect(document.activeElement).toBe(field(`Choice ${n}`));
    }
    expect((addChoice as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("25 choices is the most a question can have."),
    ).toBeTruthy();
    await user.click(button("Remove choice 25"));
    expect(document.activeElement).toBe(field("Choice 24"));
    expect((addChoice as HTMLButtonElement).disabled).toBe(false);
  }, 15_000);

  it("removes the right one, keeping what was typed in the others", async () => {
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER) });
    await user.type(await screen.findByLabelText("Choice 1"), "Park");
    await user.type(field("Choice 2"), "Library");
    await user.click(button("Add a choice"));
    await user.keyboard("Rink");
    await user.click(button("Remove choice 2"));
    expect((field("Choice 1") as HTMLInputElement).value).toBe("Park");
    expect((field("Choice 2") as HTMLInputElement).value).toBe("Rink");
    expect(screen.queryByLabelText("Choice 3")).toBeNull();
  });

  it("says a repeat beside the later copy, on leaving it", async () => {
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER) });
    await user.type(await screen.findByLabelText("Choice 1"), "Yes");
    await user.type(field("Choice 2"), "Yes");
    await user.tab();
    const second = field("Choice 2");
    expect(second.getAttribute("aria-invalid")).toBe("true");
    const described = second.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toBe(
      "This choice is already on the list.",
    );
    expect(field("Choice 1").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("closing time", () => {
  it("shows and focuses a kept closing time that expired during sign-in", async () => {
    const user = userEvent.setup();
    show({
      context: () => Promise.resolve(LATER),
      createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await fill(user);
    await user.click(button("Change when it closes"));
    await user.click(screen.getByRole("radio", { name: "At a time I pick" }));
    await user.type(screen.getByLabelText("Closing time"), "2026-10-20T12:01");
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await screen.findByRole("link", { name: "Sign in to post" });
    cleanup();

    const { createPoll } = show({
      context: () => Promise.resolve(LATER),
      restoreDraft: true,
      now: () => NOW + 2 * 60_000,
    });
    await screen.findByLabelText("Your question");
    await user.click(button("Post question"));
    expect(screen.getByText("Pick a time after now.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Closing time"));
    expect(screen.queryByRole("button", { name: "Post it" })).toBeNull();
    expect(createPoll).not.toHaveBeenCalled();
  });

  it("takes a picked future time, says it, and sends it in UTC", async () => {
    const user = userEvent.setup();
    const { createPoll } = show({ context: () => Promise.resolve(LATER) });
    await fill(user);
    await user.click(button("Change when it closes"));
    await user.click(screen.getByRole("radio", { name: "At a time I pick" }));
    const picker = screen.getByLabelText("Closing time") as HTMLInputElement;
    expect(picker.min).toBe("2026-10-20T12:01");
    await user.click(button("Post question"));
    expect(screen.getByText("Pick a date and time.")).toBeTruthy();
    expect(document.activeElement).toBe(picker);
    await user.type(picker, "2026-11-02T09:30");
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1].closesAt).toBe(
      new Date(2026, 10, 2, 9, 30).toISOString(),
    );
  });
});

describe("posting, confirmed in place", () => {
  it("shows every problem at once and focuses the first", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await screen.findByLabelText("Your question");
    await user.click(button("Post question"));
    expect(screen.getByText("Write the question.")).toBeTruthy();
    expect(
      screen.getAllByText("Write this choice, or remove it."),
    ).toHaveLength(2);
    expect(document.activeElement).toBe(field("Your question"));
    expect(screen.queryByText("Post it? It can't be changed.")).toBeNull();
    expect(createPoll).not.toHaveBeenCalled();
  });

  it("goes the whole way by keyboard, asks once, and posts once", async () => {
    const user = userEvent.setup();
    let finish: ((poll: Poll) => void) | undefined;
    const createPoll = vi.fn<Create>(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const { onPosted } = show({ createPoll });
    await fill(user);
    // Past "Add a choice" and the three Change links to the promise.
    const promise = screen.getByRole("checkbox");
    while (document.activeElement !== promise) await user.tab();
    await user.keyboard(" ");
    await user.tab();
    expect(document.activeElement).toBe(button("Post question"));
    await user.keyboard("{Enter}");
    // Asked in place; nothing posted yet.
    expect(screen.getByText("Post it? It can't be changed.")).toBeTruthy();
    expect(document.activeElement).toBe(button("Post it"));
    expect(createPoll).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    const sending = button("Posting…");
    expect(sending.getAttribute("aria-disabled")).toBe("true");
    await user.click(sending);
    expect(createPoll).toHaveBeenCalledExactlyOnceWith("key-1", {
      question: "Should we open a community garden?",
      choices: ["Yes", "No"],
      method: "single",
      attribution: { kind: "anonymous" },
      purposeAcknowledgement: "community-purpose-v1",
    });
    finish?.(poll({ id: "new-1" }));
    await waitFor(() =>
      expect(onPosted).toHaveBeenCalledWith(
        expect.objectContaining({ id: "new-1" }),
      ),
    );
  });

  it("puts the question away on Cancel, posting nothing", async () => {
    const user = userEvent.setup();
    const { createPoll } = show({ context: () => Promise.resolve(LATER) });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(button("Cancel"));
    expect(document.activeElement).toBe(button("Post question"));
    expect(createPoll).not.toHaveBeenCalled();
  });

  it("keeps the key through Cancel, so a retry after an uncertain failure posts once", async () => {
    const user = userEvent.setup();
    const createPoll = vi
      .fn<Create>()
      .mockRejectedValueOnce(new ApiError(0, "Couldn't reach pulse."))
      .mockResolvedValue(poll({ id: "new-1" }));
    show({ context: () => Promise.resolve(LATER), createPoll });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await screen.findByRole("alert");
    await user.click(button("Cancel"));
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(2));
    expect(createPoll.mock.calls.map(([key]) => key)).toEqual([
      "key-1",
      "key-1",
    ]);
  });

  it("posts once when pressed twice before the page redraws", async () => {
    const user = userEvent.setup();
    const createPoll = vi.fn<Create>(() => new Promise<Poll>(() => {}));
    show({ context: () => Promise.resolve(LATER), createPoll });
    await fill(user);
    await user.click(button("Post question"));
    const post = await screen.findByRole("button", { name: "Post it" });
    act(() => {
      post.click();
      post.click();
    });
    expect(createPoll).toHaveBeenCalledOnce();
  });

  it("retries an uncertain failure with the same key, and an edited question with a new one", async () => {
    const user = userEvent.setup();
    const createPoll = vi
      .fn<Create>()
      .mockRejectedValueOnce(
        new ApiError(0, "Couldn't reach pulse. Check your connection."),
      )
      .mockRejectedValueOnce(
        new ApiError(429, "You have posted five questions this hour."),
      )
      .mockResolvedValue(poll({ id: "new-1" }));
    show({ context: () => Promise.resolve(LATER), createPoll });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "We could not reach pulse. Press Post it to try again; it will not be posted twice.",
    );
    await user.click(button("Post it"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You have posted five questions this hour.",
    );
    expect(createPoll.mock.calls.map(([key]) => key)).toEqual([
      "key-1",
      "key-1",
    ]);
    // An edit is a different question: the ask is put away and a new key made.
    await user.type(field("Choice 2"), "!");
    expect(screen.queryByRole("button", { name: "Post it" })).toBeNull();
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(3));
    expect(createPoll.mock.calls[2]?.[0]).toBe("key-2");
  });

  /*
   * The routes' other refusals (#389): the server's message is safe to show,
   * and the two 429s (per-client `too_many_requests`, hourly `posting_limit`)
   * share a status, so nothing here may branch on it. Each keeps the ask up
   * with the same key, so trying again later cannot post twice.
   */
  it.each([
    [413, "body_too_large", "That question is too long to send."],
    [
      429,
      "too_many_requests",
      "Too many tries just now. Try again in a minute.",
    ],
    [429, "posting_limit", "You have posted five questions this hour."],
  ])(
    "shows the server's words for %i %s, and can try again",
    async (status, code, message) => {
      const user = userEvent.setup();
      const createPoll = vi
        .fn<Create>()
        .mockRejectedValueOnce(new ApiError(status, message, code))
        .mockResolvedValue(poll({ id: "new-1" }));
      const { onPosted } = show({
        context: () => Promise.resolve(LATER),
        createPoll,
      });
      await fill(user);
      await user.click(button("Post question"));
      await user.click(await screen.findByRole("button", { name: "Post it" }));
      expect((await screen.findByRole("alert")).textContent).toBe(message);
      await user.click(button("Post it"));
      await waitFor(() => expect(onPosted).toHaveBeenCalledOnce());
      expect(createPoll.mock.calls.map(([key]) => key)).toEqual([
        "key-1",
        "key-1",
      ]);
    },
  );

  /* #393 review: an edit mid-post would drop the key and the answer. */
  it("holds every field still while posting, so a failure is shown and retried with the same key", async () => {
    const user = userEvent.setup();
    let fail: ((err: unknown) => void) | undefined;
    const createPoll = vi
      .fn<Create>()
      .mockImplementationOnce(
        () =>
          new Promise<Poll>((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(poll({ id: "new-1" }));
    const { onPosted } = show({
      context: () => Promise.resolve(LATER),
      createPoll,
    });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    const choice = field("Choice 2") as HTMLInputElement;
    // Disabled by the fieldset around them, which the property does not show.
    expect(choice.matches(":disabled")).toBe(true);
    expect(button("Add a choice").matches(":disabled")).toBe(true);
    await user.type(choice, " typo");
    expect(choice.value).toBe("No");
    act(() => fail?.(new ApiError(0, "Couldn't reach pulse.")));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "it will not be posted twice",
    );
    expect(choice.matches(":disabled")).toBe(false);
    await user.click(button("Post it"));
    await waitFor(() => expect(onPosted).toHaveBeenCalledOnce());
    expect(createPoll.mock.calls.map(([key]) => key)).toEqual([
      "key-1",
      "key-1",
    ]);
  });

  it("says when posting opens again after the hourly limit", async () => {
    const user = userEvent.setup();
    show({
      context: () => Promise.resolve(LATER),
      createPoll: () =>
        Promise.reject(
          new ApiError(
            429,
            "You have posted five questions this hour.",
            "posting_limit",
            1500,
          ),
        ),
    });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You have posted five questions this hour. You can post again in about 25 minutes.",
    );
  });

  it("says the closing date from the time it is read, not when the form opened", async () => {
    let clock = NOW;
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER), now: () => clock });
    expect(
      await screen.findByText(/^Closes in seven days, on Oct 27, 2026/),
    ).toBeTruthy();
    clock = NOW + 2 * 24 * 60 * 60 * 1000;
    await user.type(field("Your question"), "x");
    expect(
      screen.getByText(/^Closes in seven days, on Oct 29, 2026/),
    ).toBeTruthy();
  });

  it("asks for the promise when the server says it is needed after all", async () => {
    const user = userEvent.setup();
    const createPoll = vi
      .fn<Create>()
      .mockRejectedValueOnce(
        new ApiError(422, "Make the promise first.", "purpose_required"),
      );
    show({ context: () => Promise.resolve(LATER), createPoll });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    expect(
      await screen.findByRole("heading", {
        name: "What this discussion is for",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Tick the promise to post your question."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("checkbox")),
    );
    expect(screen.queryByRole("button", { name: "Post it" })).toBeNull();
    // What was typed survives.
    expect((field("Choice 1") as HTMLInputElement).value).toBe("Yes");
  });

  it("offers sign-in again when the session ended, keeping what was written", async () => {
    const user = userEvent.setup();
    show({
      createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await fill(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    expect(
      await screen.findByRole("link", { name: "Sign in to post" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Your question was not posted. What you wrote is kept/),
    ).toBeTruthy();
    cleanup();

    // Back from that sign-in: the same words, kept only once, and the
    // promise unticked, since whoever signed in has to make it themselves.
    show({ restoreDraft: true });
    expect(
      ((await screen.findByLabelText("Your question")) as HTMLTextAreaElement)
        .value,
    ).toBe("Should we open a community garden?");
    expect((field("Choice 2") as HTMLInputElement).value).toBe("No");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    cleanup();
    show({ restoreDraft: true });
    expect(
      ((await screen.findByLabelText("Your question")) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  /* #393 review: a kept draft is not for whoever opens /new next. */
  it("does not restore a kept draft on an ordinary visit, and drops it", async () => {
    const user = userEvent.setup();
    show({
      context: () => Promise.resolve(LATER),
      createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await fill(user);
    await user.click(button("Post question"));
    await user.click(await screen.findByRole("button", { name: "Post it" }));
    await screen.findByRole("link", { name: "Sign in to post" });
    cleanup();
    expect(globalThis.localStorage.getItem("pulse.newPollDraft")).not.toBe(
      null,
    );

    show({ context: () => Promise.resolve(LATER) });
    expect(
      ((await screen.findByLabelText("Your question")) as HTMLTextAreaElement)
        .value,
    ).toBe("");
    expect(globalThis.localStorage.getItem("pulse.newPollDraft")).toBe(null);
  });

  it("says nothing was kept when nothing was", async () => {
    show({
      context: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await screen.findByRole("link", { name: "Sign in to post" });
    expect(screen.queryByText(/What you wrote is kept/)).toBeNull();
  });
});

/*
 * Operator walkthrough, 2026-10-21: /new had no bar on a phone, so there was
 * no way home. It has the app's own bar now, at every width.
 */
describe("the bar across the top", () => {
  const bar = () => within(screen.getByRole("banner"));

  it("links home and offers the way in when signed out", async () => {
    show({
      context: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    expect(
      bar().getByRole("link", { name: "pulse" }).getAttribute("href"),
    ).toBe("/");
    expect(await bar().findByRole("link", { name: "Sign in" })).toBeTruthy();
    // Not a link to the page it is on.
    expect(bar().queryByRole("link", { name: /Post/ })).toBeNull();
  });

  it("puts the account behind one button when signed in", async () => {
    const user = userEvent.setup();
    render(
      <NewPoll
        api={stubApi({
          creationContext: () => Promise.resolve(FIRST),
          me: () =>
            Promise.resolve({
              id: "v1",
              community: null,
              email: "voter@example.org",
            }),
        })}
        signInHref="/sign-in?next=new"
        onPosted={() => {}}
      />,
    );
    await user.click(await bar().findByRole("button", { name: "Account" }));
    expect(bar().getByText("voter@example.org")).toBeTruthy();
    expect(bar().getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
