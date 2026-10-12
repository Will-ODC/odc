// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type { Ballot, CastOutcome, Poll } from "../src/api/types.js";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
const main = () => within(screen.getByRole("main"));
function tally(p: Poll, ballot: Ballot) {
  return results({
    pollId: p.id,
    question: p.question,
    method: p.method,
    voters: 1,
    choices: p.choices.map((label, index) => ({
      index,
      label,
      count: ballot.includes(index) ? 1 : 0,
      share: ballot.includes(index) ? 100 : 0,
    })),
  });
}
function card() {
  return main().getByRole("region");
}
async function openCard() {
  if (!main().queryByRole("region")) {
    await userEvent.click(main().getByRole("button", { name: "Vote" }));
  }
}
async function answer(label = "Yes") {
  const user = userEvent.setup();
  await openCard();
  await user.click(within(card()).getByRole("radio", { name: label }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted.");
  return user;
}
it("loads a real question and keeps the assistant unavailable", async () => {
  const cast = vi.fn();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  expect(
    await main().findByRole("heading", { name: poll().question, level: 1 }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/Use the vote card to answer/)).toBeTruthy();
  expect(main().queryByRole("region")).toBeNull();
  expect(main().getByRole("button", { name: "Vote" })).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
});
it("shows loading, empty and errors with a working retry", async () => {
  const fetchPoll = vi.fn().mockImplementationOnce(() => new Promise(() => {}));
  const { unmount } = render(
    <Conversation api={stubApi({ poll: fetchPoll })} pollId="missing" />,
  );
  expect(screen.getByText("Loading…")).toBeTruthy();
  unmount();
  fetchPoll
    .mockRejectedValueOnce(new ApiError(404, "Missing"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(poll());
  render(<Conversation api={stubApi({ poll: fetchPoll })} pollId="missing" />);
  expect(
    await screen.findByText("There is nothing to vote on yet."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/We could not reach the ballot/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await main().findByRole("heading", { name: poll().question, level: 1 }),
  ).toBeTruthy();
});
it("casts, changes, closes and reopens results in the card", async () => {
  const p = poll();
  let attempt = 0;
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: attempt++ === 0 ? "counted" : "changed",
      ballot,
      results: tally(p, ballot),
    }),
  );
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  const user = await answer();
  expect(cast).toHaveBeenCalledWith(p.id, [1]);
  expect(
    within(card()).getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Hide" })).toBeNull();
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(main().queryByRole("region")).toBeNull();
  await user.click(main().getByRole("button", { name: "Vote" }));
  await user.click(
    within(card()).getByRole("button", { name: "Change my answer" }),
  );
  await user.click(within(card()).getByRole("radio", { name: "No" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(
    await main().findByText("That replaces your earlier answer."),
  ).toBeTruthy();
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(main().getByText("You picked No.")).toBeTruthy();
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(main().queryByRole("region")).toBeNull();
  expect(document.activeElement).toBe(
    main().getByRole("button", { name: "Vote" }),
  );
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(within(card()).getByRole("group"));
});
it("sends every approval pick, follows its lowest-index edge, and retains the conversation", async () => {
  const p = poll({
    method: "approval",
    choices: ["Park", "Library", "Rink"],
    next: ["second", "wrong", null],
  });
  const second = poll({
    id: "second",
    question: "Where should it go?",
    next: [null, null],
  });
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot: [...ballot].sort(),
      results: tally(p, ballot),
    }),
  );
  render(
    <Conversation
      api={stubApi({ poll: graph([p, second]), cast })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("checkbox", { name: "Library" }));
  await user.click(within(card()).getByRole("checkbox", { name: "Park" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted.");
  expect(cast).toHaveBeenCalledExactlyOnceWith(p.id, [1, 0]);
  expect(within(card()).getAllByText("yours")).toHaveLength(2);
  await user.click(within(card()).getByRole("button", { name: "Next" }));
  expect(
    await main().findByRole("heading", { name: second.question, level: 1 }),
  ).toBeTruthy();
  expect(main().getByText("You picked Park and Library.")).toBeTruthy();
  await user.click(main().getByRole("button", { name: p.question }));
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  expect(
    within(card()).getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
  expect(cast).toHaveBeenCalledOnce();
});
it("does not show Next when the steering choice ends the run", async () => {
  const p = poll({ next: [null, "elsewhere"] });
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        cast: async (_id, ballot) => ({
          status: "counted",
          ballot,
          results: tally(p, ballot),
        }),
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  await answer("No");
  expect(within(card()).queryByRole("button", { name: "Next" })).toBeNull();
});
it("refuses a known closed poll and lets a non-voter read final results", async () => {
  const p = poll({ open: false });
  const cast = vi.fn();
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        cast,
        results: async () => results(),
        myBallot: async () => null,
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.click(main().getByRole("button", { name: "See results" }));
  expect(await main().findByText("Nobody answered this one.")).toBeTruthy();
  await userEvent.click(main().getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(
    main().getByRole("button", { name: "Vote" }),
  );
  await openCard();
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(main().queryByText("Nobody answered this one.")).toBeNull();
  expect(cast).not.toHaveBeenCalled();
});
it("handles a poll closing during submit without offering another cast", async () => {
  const cast = vi.fn(async () => ({ status: "closed" as const }));
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await main().findByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  expect(cast).toHaveBeenCalledOnce();
});
it("a failed send keeps the picks for retry", async () => {
  const p = poll();
  const cast = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(503, "Try later."))
    .mockImplementation(async (_id: string, ballot: Ballot) => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }));
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Try later.",
  );
  await user.click(within(card()).getByRole("button", { name: "Try again" }));
  await main().findByText("Counted.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [1]);
});
it("keyboard-only picking and confirmation casts exactly once", async () => {
  let release: ((value: CastOutcome) => void) | undefined;
  const cast = vi.fn(
    () =>
      new Promise<CastOutcome>((resolve) => {
        release = resolve;
      }),
  );
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(
    main().getByRole("button", { name: "Vote" }),
  );
  await user.keyboard("{Enter}");
  await user.keyboard("2");
  await user.tab();
  await user.keyboard("{Enter}{Enter}");
  await waitFor(() =>
    expect(cast).toHaveBeenCalledExactlyOnceWith("ads-free", [1]),
  );
  expect(document.activeElement?.textContent).toBe("Sending…");
  release?.({ status: "counted", ballot: [1], results: tally(poll(), [1]) });
  await main().findByText("Counted.");
});

it("retrying a failed replacement sends the new choice rather than the prior answer", async () => {
  const p = poll();
  const cast = vi
    .fn()
    .mockImplementationOnce(async (_id: string, ballot: Ballot) => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }))
    .mockRejectedValueOnce(new ApiError(503, "Try later."))
    .mockImplementationOnce(async (_id: string, ballot: Ballot) => ({
      status: "changed",
      ballot,
      results: tally(p, ballot),
    }));
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await openCard();
  const user = await answer("Yes");
  await user.click(
    within(card()).getByRole("button", { name: "Change my answer" }),
  );
  await user.keyboard("1");
  await user.tab();
  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  expect(
    (within(card()).getByRole("radio", { name: "No" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await user.keyboard("{Enter}");
  await main().findByText("That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(main().getByText("You picked No.")).toBeTruthy();
});

const voter = { id: "v1", community: null, email: "voter@example.org" };
const banner = () => within(screen.getByRole("banner"));

it("offers the way in when nobody is signed in", async () => {
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  expect(await banner().findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(banner().queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("offers the way in when it cannot tell who is signed in", async () => {
  const me = () => Promise.reject(new Error("offline"));
  render(<Conversation api={stubApi({ me })} pollId="ads-free" />);
  expect(await banner().findByRole("link", { name: "Sign in" })).toBeTruthy();
});

it("signs out everywhere only after asking, then hands off", async () => {
  const signOut = vi.fn(() => Promise.resolve());
  const onSignedOut = vi.fn();
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ me: () => Promise.resolve(voter), signOut })}
      pollId="ads-free"
      onSignedOut={onSignedOut}
    />,
  );
  expect(await banner().findByText(voter.email)).toBeTruthy();
  expect(banner().queryByRole("link", { name: "Sign in" })).toBeNull();
  await user.click(banner().getByRole("button", { name: "Sign out" }));
  expect(signOut).not.toHaveBeenCalled();
  await user.click(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  );
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(await banner().findByRole("link", { name: "Sign in" })).toBeTruthy();
});

it("stays signed in, and says so, when signing out fails", async () => {
  const signOut = vi.fn(() => Promise.reject(new ApiError(503, "down")));
  const onSignedOut = vi.fn();
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ me: () => Promise.resolve(voter), signOut })}
      pollId="ads-free"
      onSignedOut={onSignedOut}
    />,
  );
  await user.click(await banner().findByRole("button", { name: "Sign out" }));
  await user.click(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  );
  expect((await banner().findByRole("alert")).textContent).toMatch(
    /still signed in/,
  );
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(banner().queryByRole("link", { name: "Sign in" })).toBeNull();
  expect(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  ).toBeTruthy();
});

it("sends one sign-out at a time, and hands off only once it is done", async () => {
  let finish: () => void = () => {};
  const signOut = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onSignedOut = vi.fn();
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ me: () => Promise.resolve(voter), signOut })}
      pollId="ads-free"
      onSignedOut={onSignedOut}
    />,
  );
  await user.click(await banner().findByRole("button", { name: "Sign out" }));
  await user.click(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  );
  const pending = banner().getByRole("button", { name: "Signing out…" });
  expect(pending.getAttribute("aria-disabled")).toBe("true");
  await user.click(pending);
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(onSignedOut).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
});

it("does not show an old failure when the question is asked again", async () => {
  const signOut = vi.fn(() => Promise.reject(new ApiError(503, "down")));
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ me: () => Promise.resolve(voter), signOut })}
      pollId="ads-free"
    />,
  );
  await user.click(await banner().findByRole("button", { name: "Sign out" }));
  await user.click(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  );
  await banner().findByRole("alert");
  await user.click(banner().getByRole("button", { name: "Cancel" }));
  await user.click(banner().getByRole("button", { name: "Sign out" }));
  expect(banner().queryByRole("alert")).toBeNull();
});
