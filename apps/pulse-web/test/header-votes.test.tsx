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

const recoveryPages = pages.filter(
  ({ route }) =>
    route.kind === "about" ||
    route.kind === "browse" ||
    route.kind === "newPoll",
);
function showFailedRead(route: Route, myVotes: () => Promise<MyVotesPage>) {
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
  return { signOut, header: within(screen.getByRole("banner")) };
}
describe.each(recoveryPages)(
  "$name failed history read (#487)",
  ({ route }) => {
    it("keeps Forget available after a failed history read", async () => {
      const user = userEvent.setup();
      const { signOut, header } = showFailedRead(route, async () => {
        throw new Error("offline");
      });
      await user.click(await header.findByRole("button", { name: "Account" }));
      expect(
        await header.findByText("We couldn't load your votes. Try again."),
      ).toBeTruthy();
      expect(header.getByRole("button", { name: "Try again" })).toBeTruthy();
      await user.click(
        header.getByRole("button", { name: "Forget my votes here" }),
      );
      await user.click(header.getByRole("button", { name: "Forget them" }));
      await header.findByRole("link", { name: "Sign in" });
      expect(header.queryByRole("button", { name: "Account" })).toBeNull();
      expect(signOut).toHaveBeenCalledTimes(1);
    });
    it.each([false, true])(
      "retries a failed read and shows the recovered held-vote state (%s)",
      async (hasVotes) => {
        const user = userEvent.setup();
        let finish!: (page: MyVotesPage) => void;
        const myVotes = vi
          .fn<() => Promise<MyVotesPage>>()
          .mockRejectedValueOnce(new Error("offline"))
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          );
        const { header } = showFailedRead(route, myVotes);
        await user.click(
          await header.findByRole("button", { name: "Account" }),
        );
        await user.click(
          await header.findByRole("button", { name: "Try again" }),
        );
        expect(header.getByRole("button", { name: "Account" })).toBeTruthy();
        expect(header.getByText("Loading your votes…")).toBeTruthy();
        expect(
          header.getByRole("button", { name: "Forget my votes here" }),
        ).toBeTruthy();
        await act(async () =>
          finish({ votes: hasVotes ? [saved] : [], nextCursor: null }),
        );
        if (hasVotes) {
          expect(header.getByRole("button", { name: "Account" })).toBeTruthy();
          expect(
            header.queryByText("We couldn't load your votes. Try again."),
          ).toBeNull();
        } else {
          expect(
            await header.findByRole("link", { name: "Sign in" }),
          ).toBeTruthy();
          expect(header.queryByRole("button", { name: "Account" })).toBeNull();
        }
        expect(myVotes).toHaveBeenCalledTimes(2);
      },
    );
  },
);

it("does not restore Account when a retry completes after Forget (#487)", async () => {
  let finish!: (page: MyVotesPage) => void;
  const myVotes = vi
    .fn<() => Promise<MyVotesPage>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const { header, signOut } = showFailedRead({ kind: "about" }, myVotes);
  const user = userEvent.setup();
  await user.click(await header.findByRole("button", { name: "Account" }));
  await user.click(await header.findByRole("button", { name: "Try again" }));
  await user.click(
    header.getByRole("button", { name: "Forget my votes here" }),
  );
  await user.click(header.getByRole("button", { name: "Forget them" }));
  await header.findByRole("link", { name: "Sign in" });
  await act(async () => finish({ votes: [saved], nextCursor: null }));
  expect(header.queryByRole("button", { name: "Account" })).toBeNull();
  expect(signOut).toHaveBeenCalledTimes(1);
});
