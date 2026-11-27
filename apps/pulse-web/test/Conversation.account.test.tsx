// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import type { Ballot } from "../src/api/types.js";
import { Conversation } from "../src/screens/Conversation.js";
import { poll, stubApi } from "./stub-api.js";
import {
  main,
  answer,
  banner,
  openAccount,
  castYes,
  said,
} from "./conversation-fixtures.js";
import { tally } from "./pulse-server.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

const voter = { id: "v1", community: null, email: "voter@example.org" };
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
  render(<Conversation api={stubApi({ cast: castYes })} pollId="ads-free" />);
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
  render(
    <Conversation
      api={stubApi({ cast: castYes, signOut })}
      pollId="ads-free"
    />,
  );
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

it.each(["public", "anonymous"] as const)(
  "clears a saved %s answer and its rail row on sign-out",
  async (votePrivacy) => {
    const user = userEvent.setup();
    const question = poll({ votePrivacy });
    let signedIn = true;
    const api = stubApi({
      me: async () => (signedIn ? voter : null),
      poll: async () => question,
      myBallot: async () => (signedIn ? [1] : null),
      results: async () => ({ ...tally(question, [1]), votePrivacy }),
      signOut: async () => {
        signedIn = false;
      },
    });
    render(<Conversation api={api} pollId={question.id} />);
    await main().findByText(said("You picked Yes."));
    const rail = within(screen.getByRole("navigation", { name: "My votes" }));
    await rail.findByRole("link", { name: question.question });
    await openAccount(user);
    await user.click(banner().getByRole("button", { name: "Sign out" }));
    await user.click(
      banner().getByRole("button", { name: "Sign out everywhere" }),
    );
    if (votePrivacy === "public") {
      await main().findByRole("link", { name: "Sign in with email to vote" });
    } else {
      const submit = await main().findByRole("button", { name: "Submit" });
      expect(submit).toHaveProperty("disabled", true);
    }
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
    expect(rail.queryByRole("link", { name: question.question })).toBeNull();
  },
);
