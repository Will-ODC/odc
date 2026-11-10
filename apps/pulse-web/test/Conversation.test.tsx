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
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type { Ballot, CastOutcome, Poll } from "../src/api/types.js";
import { App } from "../src/App.js";
import { closingNote } from "../src/flow/conversation.js";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

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
  // Closing leaves a handle in the drawer, and focus on it.
  expect(document.activeElement).toBe(
    within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
      "button",
      { name: "Vote" },
    ),
  );
  await user.click(main().getByRole("heading", { name: poll().question }));
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
  expect(main().getByText("Loading…")).toBeTruthy();
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
it("puts one results banner after the question and before the thread, with voting in the drawer", async () => {
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
  const heading = main().getByRole("heading", { name: p.question, level: 1 });
  expect(
    heading.compareDocumentPosition(standing) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    standing.compareDocumentPosition(answerRow) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    main().getAllByRole("group", { name: "How people answered" }),
  ).toHaveLength(1);
  expect(standing.classList.contains("results--compact")).toBe(true);
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

it("keeps the saved answer and its results when backing out of a change", async () => {
  const p = poll();
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }),
  );
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  const user = await answer();
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  await user.click(within(drawer).getByRole("radio", { name: "No" }));
  await user.click(within(drawer).getByRole("button", { name: "Close" }));
  const handle = within(drawer).getByRole("button", {
    name: "Change my answer",
  });
  expect(document.activeElement).toBe(handle);
  expect(main().getByText("You picked Yes.")).toBeTruthy();
  // One results banner above the thread (#453), still showing the saved answer.
  const standing = main().getByRole("group", {
    name: "How people answered",
  });
  expect(
    (await within(standing).findByRole("rowheader", { name: /\(yours\)/ }))
      .textContent,
  ).toMatch(/Yes/);
  expect(cast).toHaveBeenCalledExactlyOnceWith(p.id, [1]);
  // Reopening starts from the saved choice, not the unsent one.
  await user.click(handle);
  expect(within(drawer).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(within(drawer).getByRole("radio", { name: "No" })).toHaveProperty(
    "checked",
    false,
  );
});

it.each([
  {
    failure: "a refusal",
    error: new ApiError(409, "That did not go through."),
    restores: true,
  },
  {
    failure: "a lost connection",
    error: new Error("offline"),
    restores: false,
  },
])(
  "after $failure, closing a change restores the saved answer only if the server refused",
  async ({ error, restores }) => {
    const p = poll();
    const cast = vi
      .fn()
      .mockResolvedValueOnce({
        status: "counted",
        ballot: [1],
        results: tally(p, [1]),
      })
      .mockRejectedValueOnce(error);
    render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
    await main().findByRole("heading", { name: p.question, level: 1 });
    const user = await answer();
    const drawer = screen.getByRole("complementary", { name: "Voting" });
    await user.click(
      within(drawer).getByRole("button", { name: "Change my answer" }),
    );
    await user.click(within(drawer).getByRole("radio", { name: "No" }));
    await user.click(within(drawer).getByRole("button", { name: "Submit" }));
    await within(drawer).findByRole("alert");
    await user.click(within(drawer).getByRole("button", { name: "Close" }));
    const results = main().queryByRole("group", {
      name: "How people answered",
    });
    if (restores) {
      expect(results).not.toBeNull();
      expect(
        within(drawer).getByRole("button", { name: "Change my answer" }),
      ).toBeTruthy();
    } else {
      // The new answer may have been stored: show no counts that claim Yes.
      expect(results).toBeNull();
      expect(within(drawer).getByRole("button", { name: "Vote" })).toBeTruthy();
    }
  },
);

it("names the closed question's handle Show question, not Vote", async () => {
  const p = poll({ open: false });
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        results: async () => results(),
        myBallot: async () => null,
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  expect(within(drawer).queryByRole("button", { name: "Vote" })).toBeNull();
  const handle = within(drawer).getByRole("button", { name: "Show question" });
  expect(document.activeElement).toBe(handle);
  await user.click(handle);
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
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
  expect(
    await within(card()).findAllByRole("rowheader", { name: /\(yours\)/ }),
  ).toHaveLength(2);
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
  expect(standing.classList.contains("results--compact")).toBe(true);
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
  const note = main().getByText(closingNote(poll()));
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await main().findByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  expect(main().getByText("This question has closed.")).toBe(note);
  expect(main().queryByText(closingNote(poll()))).toBeNull();
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
  await user.tab(); // Copy link, under the question
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
  let held: Ballot | null = [1];
  const signOut = vi.fn(async () => {
    held = null;
  });
  const onSignedOut = vi.fn();
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ myBallot: async () => held, signOut })}
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
    expect(screen.getByRole("navigation", { name: "My votes" })).toBeTruthy(),
  );
  expect(
    within(screen.getByRole("navigation", { name: "My votes" })).getByText(
      "No votes saved in this browser yet.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText("More questions will appear here as you answer."),
  ).toBeNull();
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

it("keeps the closing note in the same page node when voting opens and closes", async () => {
  const p = poll({ closesAt: "2030-05-01T12:00:00.000Z" });
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  const heading = await main().findByRole("heading", {
    name: p.question,
    level: 1,
  });
  const hero = heading.parentElement!;
  const note = within(hero).getByText(closingNote(p));
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);
  expect(within(card()).queryByText(closingNote(p))).toBeNull();
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(within(hero).getByText(closingNote(p))).toBe(note);
  await user.click(main().getByRole("button", { name: "Vote" }));
  expect(within(hero).getByText(closingNote(p))).toBe(note);
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);
  expect(main().getByRole("heading", { name: p.question, level: 1 })).toBe(
    heading,
  );
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

it("offers one Copy link under the question, and none while the posted line shows it", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  try {
    const { unmount } = render(
      <Conversation api={stubApi()} pollId="ads-free" />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(main().getAllByRole("button", { name: /Copy link/ })).toHaveLength(
      1,
    );
    await userEvent.click(
      main().getByRole("button", { name: `Copy link to ${poll().question}` }),
    );
    expect(writeText).toHaveBeenCalledWith(
      new URL("/?poll=ads-free", location.href).href,
    );
    expect(await main().findByText("Copied")).toBeTruthy();
    unmount();

    render(
      <Conversation
        api={stubApi()}
        pollId="ads-free"
        posted={{
          url: "https://pulse.test/?poll=ads-free",
          onDismiss: vi.fn(),
        }}
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(
      1,
    );
    expect(screen.getByText(/Your question is live/)).toBeTruthy();
  } finally {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  }
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

describe("the Answered list (#484)", () => {
  const rail = () =>
    within(screen.getByRole("navigation", { name: "My votes" }));
  const voteLinks = () => within(rail().getByRole("list"));
  const fromServer = {
    pollId: "parks",
    question: "More parks?",
    choices: ["Yes"],
    ballot: [1],
    castAt: "2026-11-01T00:00:00.000Z",
    closesAt: null,
    open: true,
  };

  it("starts from this browser's saved answers and adds a new one on top", async () => {
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
        })}
        pollId="ads-free"
      />,
    );
    expect(
      await rail().findByRole("link", { name: "More parks?" }),
    ).toBeTruthy();
    expect(
      rail().getByRole("link", { name: "My votes" }).getAttribute("href"),
    ).toBe("/my-votes");
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer();
    const links = voteLinks().getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      poll().question,
      "More parks?",
    ]);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(rail().getAllByText("Your answer: Yes")).toHaveLength(2);
  });

  it("offers to forget votes found only in saved history", async () => {
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
        })}
        pollId="ads-free"
      />,
    );
    await rail().findByRole("link", { name: "More parks?" });

    await openAccount(userEvent.setup());
    expect(
      banner().getByRole("button", { name: "Forget my votes here" }),
    ).toBeTruthy();
  });

  it("puts a saved answer back on the page after a reload", async () => {
    const cast = vi.fn();
    const myBallot = vi.fn(async () => [0]);
    render(
      <Conversation
        api={stubApi({
          myBallot,
          results: async () => tally(poll(), [0]),
          cast,
        })}
        pollId="ads-free"
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(main().getByText("You picked No.")).toBeTruthy();
    expect(main().getByText("Counted")).toBeTruthy();
    expect(
      within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
        "button",
        { name: "Change my answer" },
      ),
    ).toBeTruthy();
    expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
    expect(cast).not.toHaveBeenCalled();
    expect(myBallot).toHaveBeenCalledExactlyOnceWith("ads-free");
  });

  it("moves a changed saved answer to the top with its new label", async () => {
    const current = {
      pollId: poll().id,
      question: poll().question,
      choices: ["Yes"],
      ballot: [1],
      castAt: "2026-10-31T00:00:00.000Z",
      closesAt: null,
      open: true,
    };
    const cast = vi.fn(
      async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
        status: "changed",
        ballot,
        results: tally(poll(), ballot),
      }),
    );
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({
            votes: [fromServer, current],
            nextCursor: null,
          }),
          myBallot: async () => [1],
          results: async () => tally(poll(), [1]),
          cast,
        })}
        pollId={poll().id}
      />,
    );
    expect(
      within(await rail().findByRole("list"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["More parks?", poll().question]);
    await main().findByText("You picked Yes.");
    const drawer = within(
      screen.getByRole("complementary", { name: "Voting" }),
    );
    const user = userEvent.setup();
    await user.click(drawer.getByRole("button", { name: "Change my answer" }));
    await user.click(drawer.getByRole("radio", { name: "No" }));
    await user.click(drawer.getByRole("button", { name: "Submit" }));
    await main().findByText("You picked No.");
    expect(
      voteLinks()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([poll().question, "More parks?"]);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
  });

  it("asks the question as before when the saved answer cannot be read", async () => {
    render(
      <Conversation
        api={stubApi({
          myBallot: async () => [0],
          results: () => Promise.reject(new Error("offline")),
        })}
        pollId="ads-free"
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    openCard();
    expect(within(card()).getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("opens a listed question in place, without loading the page again", async () => {
    const parks = poll({ id: "parks", question: "More parks?" });
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
          poll: async (id) => (id === "parks" ? parks : poll()),
        })}
        pollId="ads-free"
      />,
    );
    await userEvent.click(
      await rail().findByRole("link", { name: "More parks?" }),
    );
    expect(
      await main().findByRole("heading", { name: "More parks?", level: 1 }),
    ).toBeTruthy();
  });

  it("puts an opened rail question in history and Back restores the previous one", async () => {
    const parks = poll({ id: "parks", question: "More parks?" });
    history.replaceState(null, "", "/?poll=ads-free");
    render(
      <App
        api={stubApi({
          myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
          poll: async (id) => (id === "parks" ? parks : poll()),
        })}
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });

    await userEvent.click(
      await rail().findByRole("link", { name: "More parks?" }),
    );
    await main().findByRole("heading", { name: "More parks?", level: 1 });
    expect(location.pathname + location.search).toBe("/?poll=parks");

    act(() => history.back());
    await waitFor(() =>
      expect(location.pathname + location.search).toBe("/?poll=ads-free"),
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
  });

  it("does not navigate again when the current rail question is clicked", async () => {
    const current = {
      ...fromServer,
      pollId: poll().id,
      question: poll().question,
    };
    const onNavigate = vi.fn();
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [current], nextCursor: null }),
        })}
        pollId={poll().id}
        onNavigate={onNavigate}
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await userEvent.click(
      await rail().findByRole("link", { name: poll().question }),
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("reopens the address-named question after Next without pushing it again", async () => {
    const first = poll({ next: [null, "parks"] });
    const parks = poll({ id: "parks", question: "More parks?" });
    const onNavigate = vi.fn();
    render(
      <Conversation
        api={stubApi({ poll: graph([first, parks]) })}
        pollId={first.id}
        onNavigate={onNavigate}
      />,
    );
    await main().findByRole("heading", { name: first.question, level: 1 });
    const user = await answer("Yes");
    await user.click(within(card()).getByRole("button", { name: "Next" }));
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await user.click(rail().getByRole("link", { name: first.question }));
    await main().findByRole("heading", { name: first.question, level: 1 });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("says when the list could not be read, and tries again", async () => {
    let finishRetry!: (page: {
      votes: (typeof fromServer)[];
      nextCursor: string | null;
    }) => void;
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRetry = resolve)),
      );
    render(<Conversation api={stubApi({ myVotes })} pollId="ads-free" />);
    expect(
      await rail().findByText("We couldn't load your votes."),
    ).toBeTruthy();
    expect(rail().queryByText(/Something went wrong/)).toBeNull();
    expect(rail().getByRole("status").textContent).toContain(
      "We couldn't load your votes.",
    );
    const retry = rail().getByRole("button", { name: "Try again" });
    expect(retry.classList.contains("button")).toBe(true);
    expect(
      screen.queryByText("More questions will appear here as you answer."),
    ).toBeNull();
    await userEvent.click(retry);
    expect(rail().getByRole("status").textContent).toContain("Loading…");
    finishRetry({ votes: [fromServer], nextCursor: "next" });
    expect(
      await rail().findByRole("link", { name: "More parks?" }),
    ).toBeTruthy();
    expect(
      rail()
        .getByRole("link", { name: "See all my votes" })
        .getAttribute("href"),
    ).toBe("/my-votes");
  });

  it("reads out a rail retry from one status region, with no answers yet", async () => {
    let finishRetry!: (page: {
      votes: (typeof fromServer)[];
      nextCursor: string | null;
    }) => void;
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRetry = resolve)),
      );
    render(<Conversation api={stubApi({ myVotes })} pollId="ads-free" />);
    await rail().findByText("We couldn't load your votes.");
    const region = rail().getByRole("status");
    await userEvent.click(rail().getByRole("button", { name: "Try again" }));
    expect(rail().getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Loading…");
    await act(async () =>
      finishRetry({ votes: [fromServer], nextCursor: null }),
    );
    await rail().findByRole("link", { name: "More parks?" });
    expect(rail().getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Your votes are loaded.");
  });

  it("reads out and shows a rail retry while answers from this page are listed", async () => {
    let finishRetry!: (page: {
      votes: (typeof fromServer)[];
      nextCursor: string | null;
    }) => void;
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRetry = resolve)),
      )
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."));
    render(<Conversation api={stubApi({ myVotes })} pollId="ads-free" />);
    await rail().findByText("We couldn't load your votes.");
    const region = rail().getByRole("status");
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer();
    expect(rail().getByRole("status")).toBe(region);
    expect(region.textContent).toBe("We couldn't load all your votes.");
    await userEvent.click(rail().getByRole("button", { name: "Try again" }));
    expect(rail().getByRole("status")).toBe(region);
    expect(within(region).getByText("Loading…")).toBeTruthy();
    expect(rail().getByRole("link", { name: poll().question })).toBeTruthy();
    await act(async () =>
      finishRetry({ votes: [fromServer], nextCursor: null }),
    );
    await rail().findByRole("link", { name: "More parks?" });
    expect(rail().getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Your votes are loaded.");
  });

  it("keeps the history error and retry below answers from this page", async () => {
    render(
      <Conversation
        api={stubApi({
          myVotes: () =>
            Promise.reject(new ApiError(500, "Something went wrong.")),
        })}
        pollId="ads-free"
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer();

    expect(rail().getByRole("link", { name: poll().question })).toBeTruthy();
    expect(rail().getByText("We couldn't load all your votes.")).toBeTruthy();
    expect(rail().queryByText(/Something went wrong/)).toBeNull();
    expect(rail().getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the rail and this visit's answers when a rail question opens (#488)", async () => {
    const parks = poll({ id: "parks", question: "More parks?" });
    const myVotes = vi.fn(async () => ({
      votes: [fromServer],
      nextCursor: null,
    }));
    const me = vi.fn(async () => null);
    history.replaceState(null, "", "/?poll=ads-free");
    render(
      <App
        api={stubApi({
          myVotes,
          me,
          poll: async (id) => (id === "parks" ? parks : poll()),
        })}
      />,
    );
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer("Yes");
    const sessionReads = me.mock.calls.length;

    await userEvent.click(rail().getByRole("link", { name: "More parks?" }));
    // The conversation stays on screen: the rail does not start over.
    expect(rail().queryByText("Loading…")).toBeNull();
    expect(rail().getByRole("link", { name: poll().question })).toBeTruthy();
    await main().findByRole("heading", { name: "More parks?", level: 1 });
    expect(location.pathname + location.search).toBe("/?poll=parks");
    expect(myVotes).toHaveBeenCalledTimes(1);
    expect(me.mock.calls.length).toBe(sessionReads);
    // This visit's answer is still in the conversation thread.
    expect(main().getByText("You picked Yes.")).toBeTruthy();

    act(() => history.back());
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(rail().queryByText("Loading…")).toBeNull();
    expect(myVotes).toHaveBeenCalledTimes(1);
  });

  it("offers to forget when saved history has more pages but none on the first", async () => {
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [], nextCursor: "next" }),
        })}
        pollId="ads-free"
      />,
    );
    await rail().findByRole("link", { name: "See all my votes" });

    await openAccount(userEvent.setup());
    expect(
      banner().getByRole("button", { name: "Forget my votes here" }),
    ).toBeTruthy();
  });

  it("marks the rail's questions unavailable while an answer is being sent", async () => {
    let finish: (outcome: CastOutcome) => void = () => {};
    const cast = vi.fn(
      () =>
        new Promise<CastOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
          cast,
        })}
        pollId="ads-free"
      />,
    );
    const link = await rail().findByRole("link", { name: "More parks?" });
    await main().findByRole("heading", { name: poll().question, level: 1 });
    expect(link.getAttribute("aria-disabled")).toBeNull();
    const user = userEvent.setup();
    await user.click(within(card()).getByRole("radio", { name: "Yes" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(
        rail()
          .getByRole("link", { name: "More parks?" })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    await user.click(rail().getByRole("link", { name: "More parks?" }));
    expect(main().getByRole("heading", { level: 1 }).textContent).toBe(
      poll().question,
    );
    await act(async () =>
      finish({ status: "counted", ballot: [1], results: tally(poll(), [1]) }),
    );
    await main().findByText("Counted");
    expect(
      rail()
        .getByRole("link", { name: "More parks?" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("restores a changed answer after the address changes during its send", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    let held: number[] | null = null;
    let finish!: (outcome: CastOutcome) => void;
    const cast = vi.fn(
      () =>
        new Promise<CastOutcome>((resolve) => {
          finish = (outcome) => {
            held = [0];
            resolve(outcome);
          };
        }),
    );
    const current = {
      ...fromServer,
      pollId: first.id,
      question: first.question,
    };
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [current], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? held : null),
      results: async (id) => tally(id === first.id ? first : parks, held ?? []),
      cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByRole("heading", { name: first.question, level: 1 });
    const user = userEvent.setup();
    await user.click(within(card()).getByRole("radio", { name: "No" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await act(async () =>
      finish({ status: "changed", ballot: [0], results: tally(first, [0]) }),
    );
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked No.");
    expect(rail().getByText("Your answer: No")).toBeTruthy();
    expect(rail().queryByText("Your answer: Yes")).toBeNull();
  });

  it("shows the changed answer after leaving and returning during its send", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    // The server holds Yes until the change to No is stored.
    let held: number[] = [1];
    let finish!: (outcome: CastOutcome) => void;
    const cast = vi.fn(
      () =>
        new Promise<CastOutcome>((resolve) => {
          finish = (outcome) => {
            held = [0];
            resolve(outcome);
          };
        }),
    );
    const current = {
      ...fromServer,
      pollId: first.id,
      question: first.question,
    };
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [current], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? held : null),
      results: async (id) => tally(id === first.id ? first : parks, held ?? []),
      cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    const user = userEvent.setup();
    await user.click(
      within(card()).getByRole("button", { name: "Change my answer" }),
    );
    await user.click(within(card()).getByRole("radio", { name: "No" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await act(async () =>
      finish({ status: "changed", ballot: [0], results: tally(first, [0]) }),
    );
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked No.");
    expect(main().queryByText("You picked Yes.")).toBeNull();
    expect(rail().getByText("Your answer: No")).toBeTruthy();
    expect(rail().queryByText("Your answer: Yes")).toBeNull();
  });

  it("unlocks the rail when the address changes during a send and loading fails", async () => {
    const first = poll();
    let finish!: (outcome: CastOutcome) => void;
    const cast = vi.fn(
      () =>
        new Promise<CastOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const current = {
      ...fromServer,
      pollId: first.id,
      question: first.question,
    };
    const api = stubApi({
      poll: async (id) => {
        if (id === first.id) return first;
        throw new Error("offline");
      },
      myVotes: async () => ({ votes: [current], nextCursor: null }),
      myBallot: async () => [1],
      results: async () => tally(first, [1]),
      cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    const user = userEvent.setup();
    await user.click(
      within(card()).getByRole("button", { name: "Change my answer" }),
    );
    await user.click(within(card()).getByRole("radio", { name: "No" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    view.rerender(<Conversation api={api} pollId="missing" />);
    await main().findByText(/We could not reach the ballot/);
    expect(
      rail()
        .getByRole("link", { name: first.question })
        .getAttribute("aria-disabled"),
    ).toBeNull();
    // The answer being replaced is not claimed while its change is unsettled.
    expect(main().queryByText("You picked Yes.")).toBeNull();
    await act(async () =>
      finish({ status: "changed", ballot: [0], results: tally(first, [0]) }),
    );
  });

  /**
   * Casts that answer only when the test says so, in the order they were
   * sent. The server's ballot changes to a cast's when it is answered.
   */
  function heldCasts(start: Ballot | null = null) {
    const state = { held: start };
    const pending: Array<(outcome: CastOutcome) => void> = [];
    const cast = vi.fn(
      (_id: string, ballot: Ballot) =>
        new Promise<CastOutcome>((resolve) => {
          pending.push((outcome) => {
            state.held = [...ballot];
            resolve(outcome);
          });
        }),
    );
    const finish = (outcome: CastOutcome) => pending.shift()!(outcome);
    return { state, cast, finish };
  }
  const rows = () =>
    voteLinks()
      .getAllByRole("link")
      .map((link) => link.textContent);
  async function pick(label: string) {
    const user = userEvent.setup();
    await user.click(within(card()).getByRole("radio", { name: label }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    return user;
  }
  async function changeTo(label: string) {
    const user = userEvent.setup();
    await user.click(
      within(card()).getByRole("button", { name: "Change my answer" }),
    );
    return pick(label);
  }

  it("keeps a first answer changed mid-send in the rail, on top, while away and after return", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts();
    const api = stubApi({
      poll: graph([first, parks]),
      myBallot: async (id) => (id === first.id ? sends.state.held : null),
      results: async (id) =>
        tally(id === first.id ? first : parks, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByRole("heading", { name: first.question, level: 1 });
    await pick("Yes");
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [1],
        results: tally(first, [1]),
      }),
    );
    await main().findByText("You picked Yes.");
    await changeTo("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    // Its only vote is not lost from the rail while the change is sent.
    expect(rows()).toEqual([first.question]);
    expect(
      rail().queryByText("No votes saved in this browser yet."),
    ).toBeNull();
    await act(async () =>
      sends.finish({
        status: "changed",
        ballot: [0],
        results: tally(first, [0]),
      }),
    );
    expect(rows()).toEqual([first.question]);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked No.");
    expect(rows()).toEqual([first.question]);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
  });

  it("keeps the newest answer on top when A, then B, then C mid-send is left", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const rinks = poll({ id: "rinks", question: "More rinks?" });
    const sends = heldCasts([1]);
    const saved = {
      ...fromServer,
      pollId: first.id,
      question: first.question,
      castAt: "2026-10-31T00:00:00.000Z",
    };
    const api = stubApi({
      poll: graph([first, parks, rinks]),
      myVotes: async () => ({ votes: [fromServer, saved], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? sends.state.held : null),
      results: async () => tally(first, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    expect(rows()).toEqual([parks.question, first.question]);
    // B, given on this visit, moves the question to the top.
    await changeTo("No");
    await act(async () =>
      sends.finish({
        status: "changed",
        ballot: [0],
        results: tally(first, [0]),
      }),
    );
    await main().findByText("You picked No.");
    expect(rows()).toEqual([first.question, parks.question]);
    // C is sent, and the page left before it is answered.
    await changeTo("Yes");
    view.rerender(<Conversation api={api} pollId={rinks.id} />);
    await main().findByRole("heading", { name: rinks.question, level: 1 });
    expect(rows()).toEqual([first.question, parks.question]);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
    await act(async () =>
      sends.finish({
        status: "changed",
        ballot: [1],
        results: tally(first, [1]),
      }),
    );
    expect(rows()).toEqual([first.question, parks.question]);
    expect(rail().getAllByText("Your answer: Yes")).toHaveLength(2);
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    expect(rows()).toEqual([first.question, parks.question]);
  });

  it("keeps an answer confirmed in the same moment the address changes", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts();
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? sends.state.held : null),
      results: async () => tally(first, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByRole("heading", { name: first.question, level: 1 });
    await pick("No");
    // The reply lands, and the address changes before the card has seen it.
    await act(async () => {
      sends.finish({
        status: "counted",
        ballot: [0],
        results: tally(first, [0]),
      });
      await Promise.resolve();
      await Promise.resolve();
      view.rerender(<Conversation api={api} pollId={parks.id} />);
    });
    await main().findByRole("heading", { name: parks.question, level: 1 });
    expect(rows()).toEqual([first.question, parks.question]);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
    expect(main().getByText("You picked No.")).toBeTruthy();
  });

  it("lists a first answer sent while leaving on top when coming back", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts();
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? sends.state.held : null),
      results: async () => tally(first, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByRole("heading", { name: first.question, level: 1 });
    await pick("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [0],
        results: tally(first, [0]),
      }),
    );
    expect(rows()).toEqual([first.question, parks.question]);
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked No.");
    expect(rows()).toEqual([first.question, parks.question]);
  });

  it("reads the saved answer again when a send left behind loses its connection", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    let held: Ballot = [1];
    let lose!: () => void;
    const cast = vi.fn(
      (_id: string, ballot: Ballot) =>
        new Promise<CastOutcome>((_resolve, reject) => {
          lose = () => {
            // Stored, but the reply never arrived.
            held = [...ballot];
            reject(new Error("offline"));
          };
        }),
    );
    const saved = { ...fromServer, pollId: first.id, question: first.question };
    const myBallot = vi.fn(async (id: string) =>
      id === first.id ? held : null,
    );
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [fromServer, saved], nextCursor: null }),
      myBallot,
      results: async () => tally(first, held),
      cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    expect(rows()).toEqual([parks.question, first.question]);
    await changeTo("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    myBallot.mockClear();
    await act(async () => lose());
    await waitFor(() =>
      expect(rows()).toEqual([first.question, parks.question]),
    );
    expect(myBallot).toHaveBeenCalledExactlyOnceWith(first.id);
    expect(rail().getByText("Your answer: No")).toBeTruthy();
  });

  it("waits for a send left behind before drawing its question again", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts([1]);
    const saved = { ...fromServer, pollId: first.id, question: first.question };
    const myBallot = vi.fn(async (id: string) =>
      id === first.id ? sends.state.held : null,
    );
    const fetchPoll = vi.fn(graph([first, parks]));
    const api = stubApi({
      poll: fetchPoll,
      myVotes: async () => ({ votes: [saved], nextCursor: null }),
      myBallot,
      results: async () => tally(first, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    await changeTo("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    myBallot.mockClear();
    const fetches = fetchPoll.mock.results.length;
    view.rerender(<Conversation api={api} pollId={first.id} />);
    // Let the question itself load first, apart from the send settling, so
    // only the wait for the send can be what holds the saved-ballot read.
    await waitFor(() =>
      expect(fetchPoll.mock.results.length).toBeGreaterThan(fetches),
    );
    await act(async () => {
      await fetchPoll.mock.results.at(-1)!.value;
    });
    // The answer being replaced is not drawn while its change is out.
    expect(main().getByText("Loading…")).toBeTruthy();
    expect(main().queryByText("You picked Yes.")).toBeNull();
    expect(myBallot).not.toHaveBeenCalled();
    await act(async () =>
      sends.finish({
        status: "changed",
        ballot: [0],
        results: tally(first, [0]),
      }),
    );
    await main().findByText("You picked No.");
    expect(main().queryByText("You picked Yes.")).toBeNull();
    expect(myBallot).not.toHaveBeenCalled();
    expect(rail().getByText("Your answer: No")).toBeTruthy();
  });

  it("shows a question whose send is still out after 5 s without a way to send again", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts([1]);
    const saved = { ...fromServer, pollId: first.id, question: first.question };
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [saved], nextCursor: null }),
      myBallot: async (id) => (id === first.id ? sends.state.held : null),
      results: async () => tally(first, sends.state.held ?? []),
      cast: sends.cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    await changeTo("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    vi.useFakeTimers();
    try {
      view.rerender(<Conversation api={api} pollId={first.id} />);
      await elapse(0);
      expect(main().getByText("Loading…")).toBeTruthy();
      await elapse(5_000);
      // The question, but not unanswered with Submit: a second send would
      // race the one still out.
      main().getByRole("heading", { name: first.question, level: 1 });
      expect(main().getByText("Your answer is still being sent.")).toBeTruthy();
      expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
      expect(main().queryByRole("button", { name: "Answer" })).toBeNull();
      expect(main().queryByText("You picked Yes.")).toBeNull();
      await elapse(60_000);
      expect(main().getByText("Your answer is still being sent.")).toBeTruthy();
      await act(async () =>
        sends.finish({
          status: "changed",
          ballot: [0],
          results: tally(first, [0]),
        }),
      );
      await elapse(0);
      main().getByText("You picked No.");
      expect(main().queryByText("Your answer is still being sent.")).toBeNull();
      expect(sends.cast).toHaveBeenCalledTimes(1);
      expect(rail().getByText("Your answer: No")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the saved answer's place when a send left behind was never stored", async () => {
    const first = poll();
    const parks = poll({ id: "parks", question: "More parks?" });
    let lose!: () => void;
    const cast = vi.fn(
      () =>
        new Promise<CastOutcome>((_resolve, reject) => {
          // Lost before the server stored it: the saved answer still stands.
          lose = () => reject(new Error("offline"));
        }),
    );
    const saved = { ...fromServer, pollId: first.id, question: first.question };
    const myBallot = vi.fn(async (id: string) =>
      id === first.id ? [1] : null,
    );
    const results = vi.fn(async () => tally(first, [1]));
    const api = stubApi({
      poll: graph([first, parks]),
      myVotes: async () => ({ votes: [fromServer, saved], nextCursor: null }),
      myBallot,
      results,
      cast,
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByText("You picked Yes.");
    expect(rows()).toEqual([parks.question, first.question]);
    await changeTo("No");
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    myBallot.mockClear();
    results.mockClear();
    await act(async () => lose());
    await waitFor(() => expect(results).toHaveBeenCalled());
    await act(async () => {
      await results.mock.results.at(-1)!.value;
    });
    expect(myBallot).toHaveBeenCalledExactlyOnceWith(first.id);
    // The same answer read back is not a new cast, so it does not move up.
    expect(rows()).toEqual([parks.question, first.question]);
    expect(rail().getAllByText("Your answer: Yes")).toHaveLength(2);
    expect(rail().queryByText("Your answer: No")).toBeNull();
  });

  it("drops a send that settles after the votes are forgotten", async () => {
    const sends = heldCasts();
    const api = stubApi({
      myVotes: async () => ({ votes: [fromServer], nextCursor: null }),
      cast: sends.cast,
      results: async () => tally(poll(), [1]),
      signOut: async () => {},
    });
    render(<Conversation api={api} pollId={poll().id} />);
    await main().findByRole("heading", { name: poll().question, level: 1 });
    openCard();
    const user = await pick("Yes");
    await openAccount(user);
    await user.click(
      banner().getByRole("button", { name: "Forget my votes here" }),
    );
    await user.click(banner().getByRole("button", { name: "Forget them" }));
    await rail().findByText("No votes saved in this browser yet.");
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [1],
        results: tally(poll(), [1]),
      }),
    );
    await act(async () => {});
    expect(rail().queryByRole("link", { name: poll().question })).toBeNull();
    expect(
      rail().getByText("No votes saved in this browser yet."),
    ).toBeTruthy();
    expect(main().queryByText("You picked Yes.")).toBeNull();
  });

  it("keeps the rail locked when the address catches up with the question shown", async () => {
    const first = poll({ next: ["parks", "parks"] });
    const parks = poll({ id: "parks", question: "More parks?" });
    const sends = heldCasts();
    const api = stubApi({
      poll: graph([first, parks]),
      cast: sends.cast,
      results: async () => tally(first, [1]),
    });
    const view = render(<Conversation api={api} pollId={first.id} />);
    await main().findByRole("heading", { name: first.question, level: 1 });
    await pick("Yes");
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [1],
        results: tally(first, [1]),
      }),
    );
    const user = userEvent.setup();
    await user.click(
      await within(card()).findByRole("button", { name: "Next" }),
    );
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await pick("Yes");
    await waitFor(() =>
      expect(
        rail()
          .getByRole("link", { name: first.question })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    // Forward onto the question already on screen: its send is still out.
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    expect(
      rail()
        .getByRole("link", { name: first.question })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [1],
        results: tally(parks, [1]),
      }),
    );
    expect(
      rail()
        .getByRole("link", { name: first.question })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("does not read out an old rail retry after the votes are forgotten", async () => {
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockResolvedValue({ votes: [fromServer], nextCursor: null });
    render(
      <Conversation
        api={stubApi({ myVotes, signOut: async () => {} })}
        pollId="ads-free"
      />,
    );
    const user = userEvent.setup();
    await user.click(await rail().findByRole("button", { name: "Try again" }));
    await rail().findByRole("link", { name: "More parks?" });
    const region = rail().getByRole("status");
    expect(region.textContent).toBe("Your votes are loaded.");
    await openAccount(user);
    await user.click(
      banner().getByRole("button", { name: "Forget my votes here" }),
    );
    await user.click(banner().getByRole("button", { name: "Forget them" }));
    await rail().findByText("No votes saved in this browser yet.");
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer();
    expect(rail().getByRole("link", { name: poll().question })).toBeTruthy();
    expect(rail().getByRole("status").textContent).toBe("");
  });

  /** Moves fake time on by exactly `ms`, settling what that lets finish. */
  const elapse = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("asks the question when reading the saved ballot never finishes", async () => {
    vi.useFakeTimers();
    try {
      const myBallot = vi.fn(() => new Promise<Ballot | null>(() => {}));
      render(<Conversation api={stubApi({ myBallot })} pollId="ads-free" />);
      await elapse(0);
      expect(myBallot).toHaveBeenCalled();
      await elapse(4_999);
      expect(main().queryByRole("heading", { level: 1 })).toBeNull();
      await elapse(1);
      main().getByRole("heading", { name: poll().question, level: 1 });
      openCard();
      expect(
        within(card()).getByRole("button", { name: "Submit" }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks unanswered when the wait runs out, even with the question in the rail", async () => {
    vi.useFakeTimers();
    try {
      const current = {
        ...fromServer,
        pollId: poll().id,
        question: poll().question,
        choices: ["No"],
        ballot: [0],
      };
      const results = vi.fn(async () => tally(poll(), [0]));
      render(
        <Conversation
          api={stubApi({
            myVotes: async () => ({ votes: [current], nextCursor: null }),
            myBallot: () => new Promise<Ballot | null>(() => {}),
            results,
          })}
          pollId={poll().id}
        />,
      );
      await elapse(0);
      rail().getByText("Your answer: No");
      await elapse(4_999);
      expect(main().queryByRole("heading", { level: 1 })).toBeNull();
      await elapse(1);
      main().getByRole("heading", { name: poll().question, level: 1 });
      openCard();
      expect(
        within(card()).getByRole("button", { name: "Submit" }),
      ).toBeTruthy();
      expect(main().queryByText("You picked No.")).toBeNull();
      // A rail row is not read as the saved answer, so its results are not asked for.
      expect(results).not.toHaveBeenCalled();
      expect(rail().getByText("Your answer: No")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the 5 s wait and one saved-ballot read when the rail arrives during it", async () => {
    vi.useFakeTimers();
    try {
      const current = {
        ...fromServer,
        pollId: poll().id,
        question: poll().question,
        choices: ["No"],
        ballot: [0],
      };
      let finishVotes!: (page: {
        votes: (typeof current)[];
        nextCursor: string | null;
      }) => void;
      const myBallot = vi.fn(() => new Promise<Ballot | null>(() => {}));
      render(
        <Conversation
          api={stubApi({
            myVotes: () => new Promise((resolve) => (finishVotes = resolve)),
            myBallot,
          })}
          pollId={poll().id}
        />,
      );
      await elapse(0);
      expect(myBallot).toHaveBeenCalled();
      await elapse(4_998);
      await act(async () =>
        finishVotes({ votes: [current], nextCursor: null }),
      );
      await elapse(1);
      rail().getByText("Your answer: No");
      expect(main().queryByRole("heading", { level: 1 })).toBeNull();
      await elapse(1);
      main().getByRole("heading", { name: poll().question, level: 1 });
      expect(myBallot).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the question when the saved answer's results never arrive", async () => {
    vi.useFakeTimers();
    try {
      const results = vi.fn(() => new Promise<never>(() => {}));
      render(
        <Conversation
          api={stubApi({ myBallot: async () => [0], results })}
          pollId="ads-free"
        />,
      );
      await elapse(0);
      expect(results).toHaveBeenCalled();
      await elapse(4_999);
      expect(main().queryByRole("heading", { level: 1 })).toBeNull();
      await elapse(1);
      main().getByRole("heading", { name: poll().question, level: 1 });
      openCard();
      expect(
        within(card()).getByRole("button", { name: "Submit" }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps focus in the rail after Try again", async () => {
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockResolvedValue({ votes: [fromServer], nextCursor: null });
    render(<Conversation api={stubApi({ myVotes })} pollId="ads-free" />);
    await userEvent.click(
      await rail().findByRole("button", { name: "Try again" }),
    );
    expect(document.activeElement).toBe(
      rail().getByRole("link", { name: "My votes" }),
    );
    await rail().findByRole("link", { name: "More parks?" });
    expect(document.activeElement).toBe(
      rail().getByRole("link", { name: "My votes" }),
    );
  });

  it("links to more saved votes instead of claiming an unfinished page is empty", async () => {
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [], nextCursor: "next" }),
        })}
        pollId="ads-free"
      />,
    );

    expect(
      await rail().findByRole("link", { name: "See all my votes" }),
    ).toBeTruthy();
    expect(
      rail().queryByText("No votes saved in this browser yet."),
    ).toBeNull();
  });
});
