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
import { closingNote } from "../src/flow/conversation.js";
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
function openCard() {
  // Cards open by default (#401); fail loudly rather than click Vote.
  expect(main().queryByRole("region")).not.toBeNull();
}
async function answer(label = "Yes") {
  const user = userEvent.setup();
  openCard();
  await user.click(within(card()).getByRole("radio", { name: label }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  return user;
}
it("links a counted vote to the trust page (#351)", async () => {
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  openCard();
  expect(
    within(card()).queryByRole("link", { name: /How votes count/ }),
  ).toBeNull();
  await answer();
  expect(
    within(card())
      .getByRole("link", { name: /How votes count/ })
      .getAttribute("href"),
  ).toBe("/trust");
});
it("opens the first question expanded without selecting or sending an answer", async () => {
  const cast = vi.fn();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  expect(
    await main().findByRole("heading", { name: poll().question, level: 1 }),
  ).toBeTruthy();
  // No "Message" box until an assistant exists (walkthrough, 2026-10-21).
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByText(/assistant is not available/)).toBeNull();
  expect(within(card()).getByRole("group")).toBeTruthy();
  expect(
    within(card())
      .getAllByRole("radio")
      .every((input) => !(input as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(card()).getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(main().queryByRole("button", { name: "Vote" })).toBeNull();
  expect(cast).not.toHaveBeenCalled();
});
it("keeps a manually closed card closed and preserves its unsent pick on reopen", async () => {
  const cast = vi.fn();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("heading", { name: "Answered" }));
  expect(main().queryByRole("region")).toBeNull();
  await user.click(main().getByRole("button", { name: "Vote" }));
  expect(within(card()).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(document.activeElement).toBe(
    within(card()).getByRole("radio", { name: "Yes" }),
  );
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
it("keeps results under the answer while the bottom drawer is only for voting", async () => {
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
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  expect(within(drawer).getByRole("button", { name: "Submit" })).toBeTruthy();
  const user = await answer();
  const standing = main().getByRole("group", { name: "How people answered" });
  const answerRow = main().getByText("You picked Yes.").closest("li")!;
  expect(answerRow.contains(standing)).toBe(true);
  expect(
    within(drawer).queryByRole("group", { name: "How people answered" }),
  ).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(standing));
  expect(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  ).toBeTruthy();
  expect(within(drawer).queryByRole("button", { name: "Vote" })).toBeNull();
  await user.click(
    within(card()).getByRole("button", { name: "Change my answer" }),
  );
  expect(within(drawer).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(document.activeElement).toBe(
    within(drawer).getByRole("radio", { name: "Yes" }),
  );
  await user.click(within(drawer).getByRole("radio", { name: "No" }));
  await user.click(within(drawer).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(await main().findByText("You picked No.")).toBeTruthy();
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  expect(within(drawer).getByRole("button", { name: "Submit" })).toBeTruthy();
  expect(cast).toHaveBeenCalledTimes(2);
});

it("opens the next question's card even if the previous card was closed (#401)", async () => {
  const p = poll({ next: [null, "second"] });
  const second = poll({ id: "second", question: "Where?", next: [null, null] });
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }),
  );
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ poll: graph([p, second]), cast })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  await user.click(within(card()).getByRole("button", { name: "Next" }));
  await main().findByRole("heading", { name: second.question, level: 1 });
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(main().queryByRole("region")).toBeNull();
  await user.click(main().getByRole("button", { name: p.question }));
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(main().queryByRole("region")).not.toBeNull();
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
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("checkbox", { name: "Library" }));
  await user.click(within(card()).getByRole("checkbox", { name: "Park" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  expect(cast).toHaveBeenCalledExactlyOnceWith(p.id, [1, 0]);
  expect(within(card()).getAllByText("yours")).toHaveLength(2);
  await user.click(within(card()).getByRole("button", { name: "Next" }));
  expect(
    await main().findByRole("heading", { name: second.question, level: 1 }),
  ).toBeTruthy();
  expect(main().getByText("You picked Park and Library.")).toBeTruthy();
  expect(within(card()).getByRole("group")).toBeTruthy();
  expect(
    within(card())
      .getAllByRole("radio")
      .every((input) => !(input as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(card()).getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(cast).toHaveBeenCalledOnce();
  await user.click(main().getByRole("button", { name: p.question }));
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
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
  openCard();
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
  openCard();
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.click(main().getByRole("button", { name: "See results" }));
  expect(await main().findByText("Nobody answered this one.")).toBeTruthy();
  const standing = main().getByRole("group", { name: "How people answered" });
  expect(
    screen.getByRole("complementary", { name: "Voting" }).contains(standing),
  ).toBe(false);
  await userEvent.click(
    within(standing).getByRole("button", { name: "Close" }),
  );
  expect(document.activeElement).toBe(
    main().getByRole("button", { name: "See results" }),
  );
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(main().queryByText("Nobody answered this one.")).toBeNull();
  expect(cast).not.toHaveBeenCalled();
});
it("handles a poll closing during submit without offering another cast", async () => {
  const cast = vi.fn(async () => ({ status: "closed" as const }));
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  openCard();
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
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Try later.",
  );
  await user.click(within(card()).getByRole("button", { name: "Try again" }));
  await main().findByText("Counted");
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
  await user.tab(); // Close
  await user.tab(); // First choice
  expect(document.activeElement).toBe(
    main().getByRole("radio", { name: "No" }),
  );
  await user.keyboard("2");
  await user.tab();
  await user.keyboard("{Enter}{Enter}");
  await waitFor(() =>
    expect(cast).toHaveBeenCalledExactlyOnceWith("ads-free", [1]),
  );
  expect(document.activeElement?.textContent).toBe("Sending…");
  release?.({ status: "counted", ballot: [1], results: tally(poll(), [1]) });
  await main().findByText("Counted");
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
  openCard();
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
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  // The transcript line catches up after the card; wait for it (raced on CI).
  expect(await main().findByText("You picked No.")).toBeTruthy();
});

const voter = { id: "v1", community: null, email: "voter@example.org" };
// The page's own bar comes first; an answered card can carry a header too.
const banner = () => within(screen.getAllByRole("banner")[0]!);
/** The account's controls sit behind one button (walkthrough, 2026-10-21). */
async function openAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await banner().findByRole("button", { name: "Account" }));
}

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
  // One account control in the bar; the address is not printed in it.
  expect(await banner().findByRole("button", { name: "Account" })).toBeTruthy();
  expect(banner().getByText(voter.email).closest("[hidden]")).not.toBeNull();
  expect(banner().queryByRole("link", { name: "Sign in" })).toBeNull();
  await openAccount(user);
  expect(banner().getByText(voter.email)).toBeTruthy();
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
  await openAccount(user);
  await user.click(banner().getByRole("button", { name: "Sign out" }));
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
  await openAccount(user);
  await user.click(banner().getByRole("button", { name: "Sign out" }));
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
  await openAccount(user);
  await user.click(banner().getByRole("button", { name: "Sign out" }));
  await user.click(
    banner().getByRole("button", { name: "Sign out everywhere" }),
  );
  await banner().findByRole("alert");
  await user.click(banner().getByRole("button", { name: "Cancel" }));
  await user.click(banner().getByRole("button", { name: "Sign out" }));
  expect(banner().queryByRole("alert")).toBeNull();
});

it("offers nothing to forget when this browser holds no votes", async () => {
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await banner().findByRole("link", { name: "Sign in" });
  expect(
    banner().queryByRole("button", { name: "Forget my votes here" }),
  ).toBeNull();
});

/*
 * A shared computer: someone voted without signing in and walked away. The
 * ballot cookie is still here, so the next person would see and replace
 * their answers. The way to forget them is the same request as signing out.
 */
it("lets someone who never signed in forget this browser's votes", async () => {
  const signOut = vi.fn(() => Promise.resolve());
  const onSignedOut = vi.fn();
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ myBallot: async () => [1], signOut })}
      pollId="ads-free"
      onSignedOut={onSignedOut}
    />,
  );
  // "Sign in" is kept with it behind the one account button.
  expect(banner().queryByRole("link", { name: "Sign in" })).toBeNull();
  await openAccount(user);
  expect(banner().getByRole("link", { name: "Sign in" })).toBeTruthy();
  await user.click(
    banner().getByRole("button", { name: "Forget my votes here" }),
  );
  const confirm = banner().getByRole("button", { name: "Forget them" });
  const describedBy = confirm.getAttribute("aria-describedby") ?? "";
  expect(document.getElementById(describedBy)?.textContent).toMatch(
    /still count/,
  );
  expect(signOut).not.toHaveBeenCalled();
  await user.click(confirm);
  await waitFor(() =>
    expect(
      banner().queryByRole("button", { name: "Forget my votes here" }),
    ).toBeNull(),
  );
  expect(signOut).toHaveBeenCalledTimes(1);
  // Nobody was signed in, so nothing to hand off to.
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(banner().getByRole("link", { name: "Sign in" })).toBeTruthy();
});

it("offers to forget once someone has answered here", async () => {
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  expect(
    banner().queryByRole("button", { name: "Forget my votes here" }),
  ).toBeNull();
  expect(banner().queryByRole("button", { name: "Account" })).toBeNull();
  const user = await answer();
  // The offer waits for the session lookup as well as the answer.
  await openAccount(user);
  expect(
    banner().getByRole("button", { name: "Forget my votes here" }),
  ).toBeTruthy();
});

it("forgetting clears the answers shown on this page", async () => {
  const signOut = vi.fn(() => Promise.resolve());
  render(<Conversation api={stubApi({ signOut })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  const user = await answer();
  // The offer waits for the session lookup as well as the answer.
  await openAccount(user);
  await user.click(
    banner().getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(banner().getByRole("button", { name: "Forget them" }));
  await waitFor(() =>
    expect(screen.getByRole("navigation", { name: "Answered" })).toBeTruthy(),
  );
  expect(
    within(screen.getByRole("navigation", { name: "Answered" })).getByText(
      "No answers yet.",
    ),
  ).toBeTruthy();
  expect(main().queryByText("Counted")).toBeNull();
});

it("says plainly when forgetting failed", async () => {
  const signOut = vi.fn(() => Promise.reject(new ApiError(503, "down")));
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ myBallot: async () => [1], signOut })}
      pollId="ads-free"
    />,
  );
  await openAccount(user);
  await user.click(
    banner().getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(banner().getByRole("button", { name: "Forget them" }));
  expect((await banner().findByRole("alert")).textContent).toMatch(
    /still has your votes/,
  );
});

it("does not offer to forget to someone who is signed in", async () => {
  render(
    <Conversation
      api={stubApi({
        me: () => Promise.resolve(voter),
        myBallot: async () => [1],
      })}
      pollId="ads-free"
    />,
  );
  await openAccount(userEvent.setup());
  expect(banner().getByText(voter.email)).toBeTruthy();
  expect(
    banner().queryByRole("button", { name: "Forget my votes here" }),
  ).toBeNull();
});

/*
 * Operator walkthrough, 2026-10-21: on a phone the question and its closing
 * date were drawn twice, at the top of the page and in the card that is open
 * on load. The card says them; the page heading stays for focus and screen
 * readers, and is merged out of sight (`.conversation__hero--merged`) until
 * the card is closed.
 */
it("says the question and closing date once while the card is open", async () => {
  const p = poll({ closesAt: "2030-05-01T12:00:00.000Z" });
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  const heading = await main().findByRole("heading", {
    name: p.question,
    level: 1,
  });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(heading.closest(".conversation__hero--merged")).not.toBeNull();
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);

  await user.click(within(card()).getByRole("button", { name: "Close" }));
  const shown = main().getByRole("heading", { name: p.question, level: 1 });
  expect(shown.closest(".conversation__hero--merged")).toBeNull();
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);
  // The same heading node throughout, so focus on it is never dropped.
  expect(shown).toBe(heading);
});

it("leaves out the 'Opens another question' hint under choices", async () => {
  const p = poll({ next: ["parks", null] });
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(within(card()).getByRole("radio", { name: "No" })).toBeTruthy();
  expect(screen.queryByText("Opens another question")).toBeNull();
});

it("links to /trust once after voting, as 'How votes count'", async () => {
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await answer();
  const links = within(card())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href") === "/trust");
  expect(links).toHaveLength(1);
  expect(links[0]?.textContent).toBe("i");
  expect(links[0]?.previousElementSibling?.textContent).toBe(
    "Change my answer",
  );
  expect(main().queryByText("Only you can see your answer here.")).toBeNull();
  expect(main().queryByText("WHERE IT STANDS")).toBeNull();
  expect(main().queryByRole("button", { name: "Show me how" })).toBeNull();
  expect(screen.queryByText(/What does this mean\?/)).toBeNull();
});

it("shows the just-posted line only when told the question was just posted", async () => {
  const onDismiss = vi.fn();
  const { unmount } = render(
    <Conversation
      api={stubApi()}
      pollId="ads-free"
      posted={{ url: "https://pulse.test/?poll=ads-free", onDismiss }}
    />,
  );
  expect(await screen.findByText(/Your question is live/)).toBeTruthy();
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  // Focus goes to the question the line sat over, not to the page.
  expect(document.activeElement).toBe(
    main().getByRole("heading", { name: poll().question, level: 1 }),
  );
  unmount();
  render(<Conversation api={stubApi()} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  expect(screen.queryByText(/Your question is live/)).toBeNull();
});

it("ends the just-posted line when Next moves to another question", async () => {
  const first = poll({ next: [null, "parks"] });
  const parks = poll({ id: "parks", question: "More parks?" });
  const onDismiss = vi.fn();
  render(
    <Conversation
      api={stubApi({ poll: graph([first, parks]) })}
      pollId={first.id}
      posted={{ url: "https://pulse.test/?poll=ads-free", onDismiss }}
    />,
  );
  await main().findByRole("heading", { name: first.question, level: 1 });
  const user = await answer("Yes");
  await user.click(within(card()).getByRole("button", { name: "Next" }));
  await main().findByRole("heading", { name: "More parks?", level: 1 });
  expect(screen.queryByText(/Your question is live/)).toBeNull();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
