// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, type MyVote, type MyVotesPage } from "../src/api/types.js";
import { App } from "../src/App.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);

const vote = (over: Partial<MyVote> = {}): MyVote => ({
  pollId: "p1",
  question: "Keep it free?",
  choices: ["Yes"],
  ballot: [0],
  castAt: "2026-10-20T12:00:00.000Z",
  closesAt: null,
  open: true,
  ...over,
});
const page = (votes: MyVote[], nextCursor: string | null = null) => ({
  votes,
  nextCursor,
});
const show = (myVotes: (cursor?: string) => Promise<MyVotesPage>) =>
  render(<App api={stubApi({ myVotes })} route={{ kind: "myVotes" }} />);

it("shows server-backed answers, loads another page, and moves focus to it", async () => {
  const user = userEvent.setup();
  const myVotes = vi.fn(async (cursor?: string) =>
    cursor
      ? page([
          vote({
            pollId: "p2",
            question: "Where next?",
            choices: ["Park"],
            open: false,
          }),
        ])
      : page([vote()], "next"),
  );
  show(myVotes);
  expect(await screen.findByText("Your answer: Yes")).toBeTruthy();
  expect(screen.getByText("Open · You can change your answer")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Your answer: Park")).toBeTruthy();
  expect(myVotes).toHaveBeenCalledWith("next");
  expect(screen.getByText("Closed · View results")).toBeTruthy();
  const added = screen.getByRole("link", { name: "Where next?" });
  expect(added.getAttribute("href")).toBe("/?poll=p2");
  await waitFor(() => expect(document.activeElement).toBe(added));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("says it is loading until the first page arrives", async () => {
  let resolve!: (value: MyVotesPage) => void;
  show(() => new Promise((done) => (resolve = done)));
  expect(await screen.findByText("Loading…")).toBeTruthy();
  resolve(page([vote()]));
  expect(await screen.findByText("Your answer: Yes")).toBeTruthy();
  expect(screen.queryByText("Loading…")).toBeNull();
});

it("explains a failed load and tries again on request", async () => {
  const user = userEvent.setup();
  const myVotes = vi
    .fn<(cursor?: string) => Promise<MyVotesPage>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page([vote()]));
  show(myVotes);
  expect(
    await screen.findByText("We couldn't load your votes. Try again."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Your answer: Yes")).toBeTruthy();
  expect(myVotes).toHaveBeenCalledTimes(2);
});

it("passes on the server's own error sentence", async () => {
  show(async () => {
    throw new ApiError(500, "Something went wrong on our side.");
  });
  expect(
    await screen.findByText("Something went wrong on our side."),
  ).toBeTruthy();
});

it("offers a way to start voting when nothing is saved", async () => {
  show(async () => page([]));
  expect(
    await screen.findByText("No votes saved in this browser yet."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Explore questions" })
      .getAttribute("href"),
  ).toBe("/");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("keeps Load more on an empty page that still has more after it", async () => {
  const user = userEvent.setup();
  // A question deleted mid-read leaves a short, even empty, page (API.md).
  const myVotes = vi.fn(async (cursor?: string) =>
    cursor ? page([vote()]) : page([], "next"),
  );
  show(myVotes);
  await user.click(await screen.findByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Your answer: Yes")).toBeTruthy();
  expect(screen.queryByText("No votes saved in this browser yet.")).toBeNull();
});

it("keeps the list and offers to retry when loading more fails", async () => {
  const user = userEvent.setup();
  const myVotes = vi
    .fn<(cursor?: string) => Promise<MyVotesPage>>()
    .mockResolvedValueOnce(page([vote()], "next"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page([vote({ pollId: "p2", choices: ["No"] })]));
  show(myVotes);
  await user.click(await screen.findByRole("button", { name: "Load more" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "We couldn't load your votes. Try again.",
  );
  expect(screen.getByText("Your answer: Yes")).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Try loading more again" }),
  );
  expect(await screen.findByText("Your answer: No")).toBeTruthy();
  expect(myVotes).toHaveBeenLastCalledWith("next");
});

it("says so when an answer's labels are not available", async () => {
  show(async () => page([vote({ choices: [], ballot: [] })]));
  expect(
    await screen.findByText("Your answer: (answer unavailable)"),
  ).toBeTruthy();
});

it("clears visible answers after forgetting this browser's votes", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn(async () => {});
  render(
    <App
      api={stubApi({ myVotes: async () => page([vote()]), signOut })}
      route={{ kind: "myVotes" }}
    />,
  );
  await screen.findByText("Your answer: Yes");
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(
    screen.getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(screen.getByRole("button", { name: "Forget them" }));
  await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  expect(
    await screen.findByText("No votes saved in this browser yet."),
  ).toBeTruthy();
  expect(screen.queryByText("Your answer: Yes")).toBeNull();
});
