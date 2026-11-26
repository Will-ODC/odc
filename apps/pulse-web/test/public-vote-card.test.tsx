// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type {
  CastOutcome,
  PublicVotesPage,
  RemoveVoteOutcome,
} from "../src/api/types.js";
import { Conversation } from "../src/screens/Conversation.js";
import { counted, poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
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
    within(submit.closest("footer")!).getByText("Votes are public"),
  ).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(submit);
  expect(cast).toHaveBeenNthCalledWith(1, question.id, [1], true);
  const list = await screen.findByRole("region", { name: "Public votes" });
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
    within(signIn.closest("footer")!).getByText("Votes are public"),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("radio", { name: "Yes" }));
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
  await vi.waitFor(() =>
    expect(within(list).getAllByRole("listitem")).toHaveLength(2),
  );
  expect(document.activeElement).toBe(within(list).getAllByRole("listitem")[1]);

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
    results: async () => empty,
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
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Remove vote" }),
  );
  await user.keyboard("{Enter}");
  expect(removeVote).toHaveBeenCalledExactlyOnceWith(question.id);
  await screen.findByText("No public votes yet. Check back for answers.");
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
  await user.click(await screen.findByRole("button", { name: "See results" }));
  await within(
    await screen.findByRole("region", { name: "Public votes" }),
  ).findByText("Ada");
  expect(
    screen.getByText(/Votes are fixed after the poll closes/),
  ).toBeTruthy();
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
  await screen.findByText(/Votes are fixed after the poll closes/);
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
  await screen.findByText("Votes are anonymous");
  await user.click(screen.getByRole("radio", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  expect(cast).toHaveBeenCalledExactlyOnceWith(question.id, [1]);
  await screen.findByText("Votes are anonymous");
  expect(screen.queryByRole("region", { name: "Public votes" })).toBeNull();
  expect(publicVotes).not.toHaveBeenCalled();
});
