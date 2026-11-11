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
import { poll, stubApi } from "./stub-api.js";

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
  it.each([false, true])(
    "keeps the first pending vote read neutral before resolving saved votes (%s)",
    async (hasVotes) => {
      let finish!: (page: MyVotesPage) => void;
      const { header } = showFailedRead(
        route,
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      // Flush the session read while keeping the vote request unresolved.
      await act(async () => {});
      expect(header.queryByRole("button", { name: "Account" })).toBeNull();
      expect(header.queryByRole("link", { name: "Sign in" })).toBeNull();
      const reserved = header
        .getByRole("link", { name: "Post a question" })
        .parentElement?.querySelector(".banner__account-space");
      expect(reserved).not.toBeNull();
      expect(reserved?.getAttribute("aria-hidden")).toBe("true");
      await act(async () =>
        finish({ votes: hasVotes ? [saved] : [], nextCursor: null }),
      );
      if (hasVotes) {
        expect(header.getByRole("button", { name: "Account" })).toBeTruthy();
      } else {
        expect(header.queryByRole("button", { name: "Account" })).toBeNull();
        expect(header.getByRole("link", { name: "Sign in" })).toBeTruthy();
      }
    },
  );
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
    await waitFor(() =>
      expect(document.activeElement).toBe(
        header.getByRole("link", { name: "Sign in" }),
      ),
    );
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
    route.kind === "newPoll" ||
    route.kind === "myVotes" ||
    route.kind === "conversation",
);
function showFailedRead(route: Route, myVotes: () => Promise<MyVotesPage>) {
  const signOut = vi.fn(async () => {});
  render(
    <App
      route={route}
      api={stubApi({
        myVotes,
        // A failed history read must retain Forget even with no readable
        // ballot for the current question to supply a fallback.
        myBallot: async () => null,
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
      expect(
        header
          .getByRole("button", { name: "Try again" })
          .classList.contains("button"),
      ).toBe(true);
      if (route.kind === "myVotes") {
        expect(header.queryByRole("alert")).toBeNull();
        expect(screen.queryAllByRole("alert")).toHaveLength(0);
        expect(header.getByRole("status").textContent).toBe(
          "We couldn't load your votes. Try again.",
        );
      }
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
        // Reach retry using only the keyboard: Sign in, then Try again.
        await user.tab();
        await user.tab();
        expect(document.activeElement).toBe(
          header.getByRole("button", { name: "Try again" }),
        );
        await user.keyboard("{Enter}");
        expect(header.getByRole("button", { name: "Account" })).toBeTruthy();
        expect(header.getByText("Loading your votes…")).toBeTruthy();
        expect(document.activeElement).toBe(
          header.getByRole("button", { name: "Account" }),
        );
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
          expect(document.activeElement).toBe(
            header.getByRole("link", { name: "Sign in" }),
          );
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

it("keeps focus on Account if a header retry fails again", async () => {
  const user = userEvent.setup();
  let fail!: (reason: Error) => void;
  const myVotes = vi
    .fn<() => Promise<MyVotesPage>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
  const { header } = showFailedRead({ kind: "about" }, myVotes);
  const account = await header.findByRole("button", { name: "Account" });
  await user.click(account);
  await user.click(header.getByRole("button", { name: "Try again" }));
  expect(document.activeElement).toBe(account);
  await act(async () => fail(new Error("still offline")));
  expect(header.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(document.activeElement).toBe(account);
});

it("does not steal focus when someone moves away during a header retry", async () => {
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
  const { header } = showFailedRead({ kind: "about" }, myVotes);
  await user.click(await header.findByRole("button", { name: "Account" }));
  await user.click(header.getByRole("button", { name: "Try again" }));
  const home = header.getByRole("link", { name: "Home" });
  act(() => home.focus());
  await act(async () => finish({ votes: [], nextCursor: null }));
  expect(document.activeElement).toBe(home);
});

describe.each([
  { name: "About", route: { kind: "about" } as Route },
  {
    name: "question",
    route: { kind: "conversation", pollId: "ads-free" } as Route,
  },
])("$name pending Forget", ({ route }) => {
  it.each([false, true])(
    "finishes Forget with focus on Sign in unless focus moved away (%s)",
    async (moveAway) => {
      let finish!: () => void;
      let forgetting = false;
      let reload!: (value: ReturnType<typeof poll>) => void;
      render(
        <App
          route={route}
          api={stubApi({
            myVotes: async () => ({ votes: [saved], nextCursor: null }),
            poll: () =>
              forgetting
                ? new Promise((resolve) => {
                    reload = resolve;
                  })
                : Promise.resolve(poll()),
            signOut: () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
          })}
        />,
      );
      const user = userEvent.setup();
      const header = within(screen.getByRole("banner"));
      await user.click(await header.findByRole("button", { name: "Account" }));
      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(
        header.getByRole("button", { name: "Forget my votes here" }),
      );
      await user.keyboard("{Enter}");
      await user.keyboard("{Enter}");
      expect(document.activeElement).toBe(
        header.getByRole("button", { name: "Forgetting…" }),
      );
      const home = header.getByRole("link", { name: "Home" });
      if (moveAway) act(() => home.focus());
      forgetting = true;
      await act(async () => finish());
      const signIn = await header.findByRole("link", { name: "Sign in" });
      expect(document.activeElement).toBe(moveAway ? home : signIn);
      if (route.kind === "conversation") {
        // Forget reloads the question. Check focus after that request and
        // its heading effect have settled, as well as before it resolves.
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
        await act(async () => reload(poll()));
        expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
        expect(document.activeElement).toBe(moveAway ? home : signIn);
      }
    },
  );
});
