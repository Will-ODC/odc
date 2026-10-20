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

afterEach(cleanup);

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
}: {
  context?: () => Promise<CreationContext>;
  createPoll?: Create;
  keys?: string[];
} = {}) {
  const onPosted = vi.fn();
  const queue = [...keys];
  render(
    <NewPoll
      api={stubApi({ creationContext: context, createPoll })}
      signInHref="/sign-in?next=new"
      onPosted={onPosted}
      newKey={() => queue.shift() ?? "spare"}
      now={() => NOW}
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

  it("will not review a first post until the promise is ticked", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await fill(user);
    await user.click(button("Review"));
    expect(
      screen.getByText("Tick the promise to post your question."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    expect(screen.queryByText("Check your question")).toBeNull();
    expect(createPoll).not.toHaveBeenCalled();
  });
});

describe("who readers see (ADR-0037)", () => {
  it("is anonymous by default, with the interim wording beside the choice", async () => {
    show();
    const anonymous = (await screen.findByRole("radio", {
      name: "Nobody: post anonymously",
    })) as HTMLInputElement;
    expect(anonymous.checked).toBe(true);
    const group = screen.getByRole("group", {
      name: "Who readers see as the poster",
    });
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(group).getByText(ANONYMITY_NOTE)).toBeTruthy();
    expect(ANONYMITY_NOTE).toBe(
      "Your name is hidden from other readers. Pulse keeps your account linked to this post to address abuse.",
    );
    // Not the moderator wording: no moderator access exists yet.
    expect(document.body.textContent).not.toMatch(/moderator/i);
    expect(screen.queryByRole("textbox", { name: "Name to show" })).toBeNull();
  });

  it("asks for a name, says it is unchecked, and posts under it", async () => {
    const user = userEvent.setup();
    const { createPoll } = show({ context: () => Promise.resolve(LATER) });
    await fill(user);
    await user.click(screen.getByRole("radio", { name: "A name I choose" }));
    expect(screen.getByText(/Pulse does not check it/).textContent).toContain(
      "readers cannot tell whether it is your real name",
    );
    await user.click(button("Review"));
    expect(
      screen.getByText("Write the name to show, or post anonymously."),
    ).toBeTruthy();
    await user.type(field("Name to show"), " Ada ");
    await user.click(button("Review"));
    expect(await screen.findByText("Posted by Ada")).toBeTruthy();
    await user.click(button("Post question"));
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1].attribution).toEqual({
      kind: "named",
      name: "Ada",
    });
  });
});

describe("choices", () => {
  it("adds up to 25, focusing each new one, and removes back to 2", async () => {
    const user = userEvent.setup();
    show({ context: () => Promise.resolve(LATER) });
    await screen.findByLabelText("Your question");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    for (let n = 3; n <= 25; n += 1) {
      await user.click(button("Add a choice"));
      expect(document.activeElement).toBe(field(`Choice ${n}`));
    }
    expect((button("Add a choice") as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("25 choices is the most a question can have."),
    ).toBeTruthy();
    await user.click(button("Remove choice 25"));
    expect(document.activeElement).toBe(field("Choice 24"));
    expect((button("Add a choice") as HTMLButtonElement).disabled).toBe(false);
  });

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
  it("defaults to seven days, said as a date", async () => {
    show();
    const seven = (await screen.findByRole("radio", {
      name: /^In seven days, on Oct 27, 2026/,
    })) as HTMLInputElement;
    expect(seven.checked).toBe(true);
    expect(screen.queryByLabelText("Closing time")).toBeNull();
  });

  it("takes a picked future time and sends it in UTC", async () => {
    const user = userEvent.setup();
    const { createPoll } = show({ context: () => Promise.resolve(LATER) });
    await fill(user);
    await user.click(screen.getByRole("radio", { name: "At a time I pick" }));
    const picker = screen.getByLabelText("Closing time") as HTMLInputElement;
    expect(picker.min).toBe("2026-10-20T12:01");
    await user.click(button("Review"));
    expect(screen.getByText("Pick a date and time.")).toBeTruthy();
    await user.type(picker, "2026-11-02T09:30");
    await user.click(button("Review"));
    await user.click(
      await screen.findByRole("button", { name: "Post question" }),
    );
    await waitFor(() => expect(createPoll).toHaveBeenCalledOnce());
    expect(vi.mocked(createPoll).mock.calls[0]?.[1].closesAt).toBe(
      new Date(2026, 10, 2, 9, 30).toISOString(),
    );
  });
});

describe("review, then post", () => {
  it("shows every problem at once and focuses the first", async () => {
    const user = userEvent.setup();
    const { createPoll } = show();
    await screen.findByLabelText("Your question");
    await user.click(button("Review"));
    expect(screen.getByText("Write the question.")).toBeTruthy();
    expect(
      screen.getAllByText("Write this choice, or remove it."),
    ).toHaveLength(2);
    expect(document.activeElement).toBe(field("Your question"));
    expect(createPoll).not.toHaveBeenCalled();
  });

  it("goes the whole way by keyboard, and posts once", async () => {
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
    // Tab past "Add a choice" and the radio groups to the promise.
    const promise = screen.getByRole("checkbox");
    while (document.activeElement !== promise) await user.tab();
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    const heading = await screen.findByRole("heading", {
      name: "Check your question",
    });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("Should we open a community garden?")).toBeTruthy();
    expect(screen.getByText("Posted anonymously")).toBeTruthy();
    expect(
      screen.getByText("It cannot be changed once it is posted."),
    ).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(button("Post question"));
    await user.keyboard("{Enter}");
    const sending = button("Posting…") as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
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

  it("posts once when pressed twice before the page redraws", async () => {
    const user = userEvent.setup();
    const createPoll = vi.fn<Create>(() => new Promise<Poll>(() => {}));
    show({ context: () => Promise.resolve(LATER), createPoll });
    await fill(user);
    await user.click(button("Review"));
    const post = await screen.findByRole("button", { name: "Post question" });
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
    await user.click(button("Review"));
    await user.click(
      await screen.findByRole("button", { name: "Post question" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "We could not reach pulse. Press Post question to try again; it will not be posted twice.",
    );
    await user.click(button("Post question"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You have posted five questions this hour.",
    );
    expect(createPoll.mock.calls.map(([key]) => key)).toEqual([
      "key-1",
      "key-1",
    ]);
    await user.click(button("Edit"));
    expect((field("Your question") as HTMLTextAreaElement).value).toBe(
      "Should we open a community garden?",
    );
    await user.click(button("Review"));
    await user.click(
      await screen.findByRole("button", { name: "Post question" }),
    );
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(3));
    expect(createPoll.mock.calls[2]?.[0]).toBe("key-2");
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
    await user.click(button("Review"));
    await user.click(
      await screen.findByRole("button", { name: "Post question" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "What this discussion is for",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Tick the promise to post your question."),
    ).toBeTruthy();
    // What was typed survives.
    expect((field("Choice 1") as HTMLInputElement).value).toBe("Yes");
  });

  it("offers sign-in again when the session ended before posting", async () => {
    const user = userEvent.setup();
    show({
      context: () => Promise.resolve(LATER),
      createPoll: () => Promise.reject(new ApiError(401, "Sign in first.")),
    });
    await fill(user);
    await user.click(button("Review"));
    await user.click(
      await screen.findByRole("button", { name: "Post question" }),
    );
    expect(
      await screen.findByRole("link", { name: "Sign in to post" }),
    ).toBeTruthy();
  });
});
