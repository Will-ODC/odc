// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ApiError } from "../src/api/types.js";
import type {
  CastOutcome,
  Me,
  MyVotesPage,
  PublicVotesPage,
  RemoveVoteOutcome,
} from "../src/api/types.js";
import { SIGNED_IN_KEY } from "../src/flow/sign-in-return.js";
import { SIGNED_OUT_KEY } from "../src/hooks/use-session.js";
import { Conversation } from "../src/screens/Conversation.js";
import { counted, poll, results, stubApi } from "./stub-api.js";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
beforeAll(() => import("../src/components/BarChart.js"));

const question = poll({ id: "public-demo", votePrivacy: "public" });
const empty = results({ pollId: question.id, votePrivacy: "public" });
const tally = { ...empty, voters: 1, confirmedVoters: 1 };
const session = { id: "ada", email: "ada@example.test", community: null };
const signedIn = async () => session;

it("puts the public notice beside Submit before a signed-in voter casts or changes an answer", async () => {
  const user = userEvent.setup();
  const cast = vi
    .fn<() => Promise<CastOutcome>>()
    .mockResolvedValueOnce(counted(1, tally))
    .mockResolvedValueOnce({ status: "changed", ballot: [0], results: tally });
  const api = stubApi({
    poll: async () => question,
    me: signedIn,
    cast,
    publicVotes: async () => ({
      items: [{ name: null, choices: [1] }],
      nextCursor: null,
    }),
  });
  render(<Conversation api={api} pollId={question.id} />);
  const submit = await screen.findByRole("button", {
    name: "Submit",
    description: /^Votes are public/,
  });
  expect(
    within(submit.closest("footer")!).getByText("Votes are public."),
  ).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(submit);
  expect(cast).toHaveBeenNthCalledWith(1, question.id, [1], true);
  const list = await screen.findByRole("region", { name: "Public votes" });
  expect(
    within(list).getByRole("heading", { name: "Public votes", level: 3 }),
  ).toBeTruthy();
  expect((await within(list).findByRole("listitem")).textContent).toBe(
    "Verified voter · Yes",
  );
  expect(within(list).getByText("Verified voter").tagName).toBe("EM");
  expect(within(list).queryByRole("link")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Change my answer" }));
  await user.click(screen.getByRole("radio", { name: "No" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  expect(cast).toHaveBeenNthCalledWith(2, question.id, [0], true);
  await screen.findByText(/That replaces your earlier answer/);
});

it("puts the notice beside a return-to-this-poll sign-in link for a signed-out visitor", async () => {
  const cast = vi.fn();
  render(
    <Conversation
      api={stubApi({ poll: async () => question, cast })}
      pollId={question.id}
    />,
  );
  const signIn = await screen.findByRole("link", {
    name: "Sign in with email to vote",
    description: /^Votes are public/,
  });
  expect(signIn.getAttribute("href")).toBe("/sign-in?poll=public-demo");
  expect(
    within(signIn.closest("footer")!).getByText("Votes are public."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  const choice = screen.getByRole("radio", { name: "Yes" });
  expect(choice.getAttribute("aria-disabled")).toBe("true");
  expect(choice.matches(":disabled")).toBe(true);
  const user = userEvent.setup();
  await user.click(choice);
  screen.getByRole("button", { name: "Close" }).focus();
  await user.tab();
  expect(document.activeElement).toBe(signIn);
  expect(screen.queryByText(/you can change your answer/i)).toBeNull();
  expect(cast).not.toHaveBeenCalled();
});

it("reads public votes for a visitor, forwards the sealed cursor, and can restart after it expires", async () => {
  const user = userEvent.setup();
  const publicVotes = vi
    .fn<(pollId: string, cursor?: string) => Promise<PublicVotesPage>>()
    .mockResolvedValueOnce({
      items: [{ name: "Ada", choices: [0] }],
      nextCursor: "sealed_token",
    })
    .mockResolvedValueOnce({
      items: [{ name: "Ada", choices: [0] }],
      nextCursor: "next_token",
    })
    .mockRejectedValueOnce(
      new ApiError(400, "Start again from the first page of votes."),
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const api = stubApi({
    poll: async () => question,
    results: async () => tally,
    publicVotes,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await user.click(await screen.findByRole("button", { name: "See results" }));
  const list = await screen.findByRole("region", { name: "Public votes" });
  await within(list).findByText("Ada");
  const more = within(list).getByRole("button", { name: "Load more votes" });
  more.focus();
  await user.keyboard("{Enter}");
  expect(publicVotes).toHaveBeenNthCalledWith(2, question.id, "sealed_token");
  // React commits the new row, then runs the focus effect; on a slow machine
  // the scheduler can yield between the two, so wait for the outcome (#733).
  await vi.waitFor(() => {
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(document.activeElement).toBe(rows[1]);
  });

  await user.click(
    within(list).getByRole("button", { name: "Load more votes" }),
  );
  await within(list).findByText("Start again from the first page of votes.");
  await user.click(
    within(list).getByRole("button", { name: "Go to first page" }),
  );
  expect(publicVotes).toHaveBeenLastCalledWith(question.id, undefined);
  await within(list).findByText("No public votes yet. Check back for answers.");
});

it("shows loading, error and retry when reading the first public results page", async () => {
  const user = userEvent.setup();
  let rejectPage!: (error: Error) => void;
  const publicVotes = vi
    .fn<() => Promise<PublicVotesPage>>()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPage = reject;
        }),
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const api = stubApi({
    poll: async () => question,
    results: async () => tally,
    publicVotes,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await user.click(await screen.findByRole("button", { name: "See results" }));
  const list = await screen.findByRole("region", { name: "Public votes" });
  expect(within(list).getByText("Loading…")).toBeTruthy();
  rejectPage(new Error("offline"));
  await within(list).findByText(
    "We couldn't load the public votes. Try again.",
  );
  await user.click(within(list).getByRole("button", { name: "Try again" }));
  await within(list).findByText("No public votes yet. Check back for answers.");
});

it("restores an account ballot and confirms removal before refreshing its public results", async () => {
  const user = userEvent.setup();
  const removeVote = vi
    .fn<() => Promise<RemoveVoteOutcome>>()
    .mockResolvedValue({ status: "removed", results: empty });
  const publicVotes = vi
    .fn<() => Promise<PublicVotesPage>>()
    .mockResolvedValueOnce({
      items: [{ name: "Ada", choices: [1] }],
      nextCursor: null,
    })
    .mockResolvedValue({ items: [], nextCursor: null });
  const api = stubApi({
    poll: async () => question,
    me: signedIn,
    myBallot: async () => [1],
    results: async () => tally,
    removeVote,
    publicVotes,
  });
  render(<Conversation api={api} pollId={question.id} />);
  const list = await screen.findByRole("region", { name: "Public votes" });
  await within(list).findByText("Ada");
  await user.click(screen.getByRole("button", { name: "Remove my vote" }));
  expect(removeVote).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("group", { name: "Remove my vote" })
      .closest(".vote-card__actions"),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Remove vote" }),
  );
  await user.keyboard("{Enter}");
  expect(removeVote).toHaveBeenCalledExactlyOnceWith(question.id);
  const note = await screen.findByText("Your vote was removed.");
  expect(note.getAttribute("role")).toBe("status");
  expect(screen.queryByRole("region", { name: "Public votes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove my vote" })).toBeNull();
  expect(screen.getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  expect(screen.getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    false,
  );
});

it("shows fixed public votes after close without voting or removal controls", async () => {
  const user = userEvent.setup();
  const api = stubApi({
    poll: async () => ({ ...question, open: false }),
    me: signedIn,
    myBallot: async () => [1],
    results: async () => tally,
    publicVotes: async () => ({
      items: [{ name: "Ada", choices: [1] }],
      nextCursor: null,
    }),
  });
  render(<Conversation api={api} pollId={question.id} />);
  const notice = "Votes are public. This poll has closed, so votes are fixed.";
  expect(await screen.findAllByText(notice)).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "See results" }));
  await within(
    await screen.findByRole("region", { name: "Public votes" }),
  ).findByText("Ada");
  expect(screen.getAllByText(notice)).toHaveLength(1);
  expect(screen.queryByText("Votes are public.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove my vote" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
});

it("keeps the saved vote when removal reaches the server after close", async () => {
  const user = userEvent.setup();
  const removeVote = vi
    .fn<() => Promise<RemoveVoteOutcome>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "closed" });
  const api = stubApi({
    poll: async () => question,
    me: signedIn,
    myBallot: async () => [1],
    results: async () => tally,
    publicVotes: async () => ({
      items: [{ name: "Ada", choices: [1] }],
      nextCursor: null,
    }),
    removeVote,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await user.click(
    await screen.findByRole("button", { name: "Remove my vote" }),
  );
  await user.click(screen.getByRole("button", { name: "Remove vote" }));
  await screen.findByText("We couldn't remove your vote. Try again.");
  await user.click(screen.getByRole("button", { name: "Remove vote" }));
  await screen.findByText(
    "Votes are public. This poll has closed, so votes are fixed.",
  );
  await within(
    await screen.findByRole("region", { name: "Public votes" }),
  ).findByText("Ada");
  expect(screen.queryByRole("button", { name: "Remove my vote" })).toBeNull();
});

it("describes anonymous votes without asking for a public list or sending acknowledgement", async () => {
  const user = userEvent.setup();
  const cast = vi
    .fn<() => Promise<CastOutcome>>()
    .mockResolvedValue(counted(1, { ...tally, votePrivacy: "anonymous" }));
  const publicVotes = vi.fn();
  const api = stubApi({
    poll: async () => ({ ...question, votePrivacy: "anonymous" }),
    cast,
    publicVotes,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await screen.findByText("Votes are anonymous.");
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  expect(cast).toHaveBeenCalledExactlyOnceWith(question.id, [1]);
  await screen.findByText("Votes are anonymous.");
  expect(screen.queryByRole("region", { name: "Public votes" })).toBeNull();
  expect(publicVotes).not.toHaveBeenCalled();
});

it("keeps voting actions blank during the session check and offers a keyboard retry after it fails", async () => {
  let fail!: (reason: Error) => void;
  const me = vi.fn(
    () =>
      new Promise<Me | null>((_, reject) => {
        fail = reject;
      }),
  );
  render(
    <Conversation
      api={stubApi({ me, poll: async () => question })}
      pollId={question.id}
    />,
  );
  await screen.findByText("Votes are public.");
  const expectNoAction = () => {
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Sign in with email to vote" }),
    ).toBeNull();
  };
  const failure = "We couldn't check whether you're signed in.";
  expectNoAction();
  expect(screen.queryByText(failure)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  await act(async () => fail(new Error("offline")));
  expectNoAction();
  expect(await screen.findByText(failure)).toBeTruthy();
  me.mockResolvedValue(null);
  screen.getByRole("button", { name: "Try again" }).focus();
  await userEvent.setup().keyboard("{Enter}");
  await screen.findByRole("link", { name: "Sign in with email to vote" });
  expect(screen.queryByText(failure)).toBeNull();
});

// Signed in, the page's own arrival focus takes the question's heading, and
// the card must not take it back.
it.each([
  ["signed out", null, { role: "link", name: "Sign in with email to vote" }],
  [
    "signed in",
    session,
    { role: "heading", name: question.question, level: 1 },
  ],
] as const)(
  "moves focus from the session Try again to what replaces it when %s",
  async (_, who, target) => {
    const me = vi
      .fn<() => Promise<Me | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(who);
    render(
      <Conversation
        api={stubApi({ me, poll: async () => question })}
        pollId={question.id}
      />,
    );
    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();
    await userEvent.setup().keyboard("{Enter}");
    const { role, ...options } = target;
    const next = await screen.findByRole(role, options);
    await waitFor(() => expect(document.activeElement).toBe(next));
  },
);

it.each(["anonymous", "public"] as const)(
  "handles a sign-out in another tab when vote privacy is %s",
  async (votePrivacy) => {
    const me = vi.fn<() => Promise<Me | null>>(signedIn);
    const current = { ...question, votePrivacy };
    window.history.replaceState(null, "", `/?poll=${current.id}`);
    render(<App api={stubApi({ me, poll: async () => current })} />);
    await screen.findByRole("button", { name: "Account" });
    await screen.findByRole("button", { name: "Submit" });

    me.mockResolvedValue(null);
    fireEvent(window, new StorageEvent("storage", { key: SIGNED_OUT_KEY }));

    if (votePrivacy === "public") {
      await screen.findByRole("link", { name: "Sign in with email to vote" });
      expect(window.location.search).toBe(`?poll=${current.id}`);
    } else {
      await screen.findByLabelText("Your email");
      expect(window.location.pathname).toBe("/sign-in");
    }
  },
);

it("restores the ballot and reloads My votes when sign-in arrives from another tab", async () => {
  const me = vi.fn<() => Promise<Me | null>>().mockResolvedValue(null);
  const myBallot = vi
    .fn<() => Promise<number[] | null>>()
    .mockResolvedValue(null);
  const other = poll({
    id: "other-public",
    question: "Another public question?",
    votePrivacy: "public",
  });
  const myVotes = vi.fn<() => Promise<MyVotesPage>>().mockResolvedValue({
    votes: [],
    nextCursor: null,
  });
  const getPoll = vi.fn(async () => question);
  const api = stubApi({
    me,
    poll: getPoll,
    myBallot,
    myVotes,
    results: async () => tally,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await screen.findByRole("link", { name: "Sign in with email to vote" });
  me.mockResolvedValue(session);
  myBallot.mockResolvedValue([1]);
  myVotes.mockResolvedValue({
    votes: [
      {
        pollId: other.id,
        votePrivacy: "public",
        question: other.question,
        choices: ["Yes"],
        ballot: [1],
        castAt: "2026-10-20T12:00:00Z",
        closesAt: null,
        open: true,
      },
    ],
    nextCursor: null,
  });
  fireEvent(window, new StorageEvent("storage", { key: SIGNED_IN_KEY }));
  await screen.findByRole("button", { name: "Remove my vote" });
  const rail = within(screen.getByRole("navigation", { name: "My votes" }));
  const row = (await rail.findByRole("link", { name: other.question })).closest(
    "li",
  )!;
  expect(await within(row).findByText("Public")).toBeTruthy();
  expect(getPoll).not.toHaveBeenCalledWith(other.id);
  const restored = rail
    .getByRole("link", { name: question.question })
    .closest("li")!;
  expect(within(restored).getByText("Public")).toBeTruthy();
});

it("refreshes the account and ballot without deleting if the account switched", async () => {
  const user = userEvent.setup();
  const me = vi.fn(signedIn);
  const myBallot = vi.fn(async () => [1]);
  const removeVote = vi.fn(async () => ({
    status: "none" as const,
    results: empty,
  }));
  const api = stubApi({
    me,
    myBallot,
    removeVote,
    poll: async () => question,
    results: async () => tally,
  });
  window.history.replaceState(null, "", `/?poll=${question.id}`);
  render(<App api={api} />);
  await user.click(
    await screen.findByRole("button", { name: "Remove my vote" }),
  );
  me.mockResolvedValue({ ...session, id: "bea", email: "bea@example.test" });
  myBallot.mockResolvedValue([0]);
  await user.click(screen.getByRole("button", { name: "Remove vote" }));
  const message = await screen.findByText(
    "Your account changed. Check your answer before trying again.",
  );
  expect(message.getAttribute("role")).toBe("status");
  const answer = await screen.findByRole("region", { name: "Your answer" });
  expect(answer.textContent).toContain("You picked No.");
  await user.click(screen.getByRole("button", { name: "Account" }));
  expect(screen.getByText("bea@example.test")).toBeTruthy();
  expect(removeVote).not.toHaveBeenCalled();
});

it.each([0, 200])(
  "reads back a removal whose reply was unreadable (status %i)",
  async (status) => {
    const user = userEvent.setup();
    const myBallot = vi
      .fn<() => Promise<number[] | null>>()
      .mockResolvedValue([1]);
    const removeVote = vi.fn(async () => {
      myBallot.mockResolvedValue(null);
      throw new ApiError(status, "Couldn't read the reply.");
    });
    const api = stubApi({
      me: signedIn,
      myBallot,
      removeVote,
      poll: async () => question,
      results: async () => (removeVote.mock.calls.length ? empty : tally),
    });
    render(<Conversation api={api} pollId={question.id} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove my vote" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove vote" }));
    await screen.findByText("Your vote was removed.");
    expect(myBallot).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "Your answer" })).toBeNull();
    const rail = within(screen.getByRole("navigation", { name: "My votes" }));
    expect(rail.queryByRole("link", { name: question.question })).toBeNull();
  },
);

it("does not read or show the public list when the results have zero voters", async () => {
  const user = userEvent.setup();
  const publicVotes = vi.fn(async () => ({ items: [], nextCursor: null }));
  render(
    <Conversation
      api={stubApi({
        poll: async () => question,
        results: async () => empty,
        publicVotes,
      })}
      pollId={question.id}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "See results" }));
  await screen.findByText("Nobody has answered yet.");
  expect(screen.queryByRole("region", { name: "Public votes" })).toBeNull();
  expect(publicVotes).not.toHaveBeenCalled();
});

it("does not identify identical public rows by matching name and answer", async () => {
  render(
    <Conversation
      api={stubApi({
        me: signedIn,
        myBallot: async () => [1],
        poll: async () => question,
        results: async () => {
          return { ...tally, voters: 2, confirmedVoters: 2 };
        },
        publicVotes: async () => ({
          items: [
            { name: null, choices: [1] },
            { name: null, choices: [1] },
          ],
          nextCursor: null,
        }),
      })}
      pollId={question.id}
    />,
  );
  const list = within(
    await screen.findByRole("region", { name: "Public votes" }),
  );
  expect(
    (await list.findAllByRole("listitem")).map((row) => row.textContent),
  ).toEqual(["Verified voter · Yes", "Verified voter · Yes"]);
});

it("keeps the ballot and does not send DELETE when the account recheck fails", async () => {
  const user = userEvent.setup();
  const me = vi.fn(signedIn);
  const removeVote = vi.fn(async () => ({
    status: "removed" as const,
    results: empty,
  }));
  const api = stubApi({
    me,
    removeVote,
    poll: async () => question,
    myBallot: async () => [1],
    results: async () => tally,
  });
  render(<Conversation api={api} pollId={question.id} />);
  await user.click(
    await screen.findByRole("button", { name: "Remove my vote" }),
  );
  me.mockRejectedValue(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Remove vote" }));
  await screen.findByText("We couldn't check your account. Try again.");
  expect(
    screen.getByRole("region", { name: "Your answer" }).textContent,
  ).toContain("You picked Yes.");
  expect(removeVote).not.toHaveBeenCalled();
});
