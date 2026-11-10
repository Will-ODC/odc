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
import { App } from "../src/App.js";
import { ApiError, type MyVote, type MyVotesPage } from "../src/api/types.js";
import type { Route } from "../src/flow/route.js";
import { stubApi } from "./stub-api.js";

afterEach(cleanup);
const saved: MyVote = {
  pollId: "ads-free",
  question: "Should the ODC stay free of paid ads?",
  choices: ["Yes"],
  ballot: [1],
  castAt: "2026-10-20T12:00:00.000Z",
  closesAt: null,
  open: true,
};
const pages: { name: string; route: Route }[] = [
  { name: "Home", route: { kind: "browse", community: "pulse-general" } },
  { name: "community browse", route: { kind: "browse", community: "demo" } },
  { name: "About", route: { kind: "about" } },
  { name: "Start", route: { kind: "progress" } },
  { name: "starting questions", route: { kind: "questions" } },
  { name: "How votes count", route: { kind: "trust" } },
  { name: "Post a question", route: { kind: "newPoll" } },
  { name: "My votes", route: { kind: "myVotes" } },
  { name: "question", route: { kind: "conversation", pollId: "ads-free" } },
];
function show(route: Route, page: MyVotesPage) {
  const myVotes = vi.fn(async () => page);
  const signOut = vi.fn(async () => {});
  render(
    <App
      route={route}
      api={stubApi({
        myVotes,
        signOut,
        listPolls: async () => ({ polls: [], nextCursor: null }),
        creationContext: async () => {
          throw new ApiError(401, "Sign in to post a question.");
        },
      })}
    />,
  );
  return { myVotes, signOut, header: within(screen.getByRole("banner")) };
}

describe.each(pages)("$name header (#487)", ({ route }) => {
  it("offers Account when this browser holds saved votes", async () => {
    const { header } = show(route, { votes: [saved], nextCursor: null });
    expect(await header.findByRole("button", { name: "Account" })).toBeTruthy();
  });
  it("offers Sign in when this browser holds no votes", async () => {
    const { header, myVotes } = show(route, { votes: [], nextCursor: null });
    expect(await header.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(myVotes).toHaveBeenCalledTimes(1);
    expect(header.queryByRole("button", { name: "Account" })).toBeNull();
  });
  it("returns to Sign in after Forget my votes succeeds", async () => {
    const user = userEvent.setup();
    const { header, signOut } = show(route, {
      votes: [saved],
      nextCursor: null,
    });
    await user.click(await header.findByRole("button", { name: "Account" }));
    await user.click(
      header.getByRole("button", { name: "Forget my votes here" }),
    );
    expect(signOut).not.toHaveBeenCalled();
    await user.click(header.getByRole("button", { name: "Forget them" }));
    expect(await header.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(header.queryByRole("button", { name: "Account" })).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  it("still offers Account when an empty page has more saved votes", async () => {
    const { header } = show(route, { votes: [], nextCursor: "next" });
    expect(await header.findByRole("button", { name: "Account" })).toBeTruthy();
  });
});

it("ignores a saved-votes page arriving after sign-out clears it (#487)", async () => {
  let finish!: (page: MyVotesPage) => void;
  const signOut = vi.fn(async () => {});
  render(
    <App
      route={{ kind: "about" }}
      api={stubApi({
        me: async () => ({
          id: "ada",
          email: "ada@example.test",
          community: null,
        }),
        myVotes: () =>
          new Promise((done) => {
            finish = done;
          }),
        signOut,
      })}
    />,
  );
  const user = userEvent.setup();
  const header = within(screen.getByRole("banner"));
  await user.click(await header.findByRole("button", { name: "Account" }));
  await user.click(header.getByRole("button", { name: "Sign out" }));
  await user.click(header.getByRole("button", { name: "Sign out everywhere" }));
  await header.findByRole("link", { name: "Sign in" });
  await act(async () => finish({ votes: [saved], nextCursor: null }));
  await waitFor(() =>
    expect(header.queryByRole("button", { name: "Account" })).toBeNull(),
  );
  expect(signOut).toHaveBeenCalledTimes(1);
});

it("keeps Forget available on sign-in without adding a link back to that same page (#487)", async () => {
  const user = userEvent.setup();
  const { header } = show(
    { kind: "signIn" },
    { votes: [saved], nextCursor: null },
  );
  await user.click(await header.findByRole("button", { name: "Account" }));
  expect(header.queryByText("Sign in", { exact: true })).toBeNull();
  await user.click(
    header.getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(header.getByRole("button", { name: "Forget them" }));
  await waitFor(() =>
    expect(header.queryByRole("button", { name: "Account" })).toBeNull(),
  );
  expect(header.queryByText("Sign in", { exact: true })).toBeNull();
});
