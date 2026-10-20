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
import { VoteCard } from "../src/components/VoteCard.js";
import type { VoteCardProps } from "../src/components/VoteCard.js";
import { countedNote } from "../src/flow/vote-card.js";
import { SIGNED_IN_KEY } from "../src/flow/sign-in-return.js";
import { Conversation } from "../src/screens/Conversation.js";
import type { Me, Results } from "../src/api/types.js";
import { poll, results, stubApi } from "./stub-api.js";

/*
 * #353: a counted vote says whether it is confirmed by email (ADR-0040), and
 * offers the way to confirm it when nobody is signed in here.
 */
afterEach(cleanup);

const ME: Me = { id: "v1", email: "jo@student.ubc.ca", community: "ubc" };
const ANSWERED: VoteCardProps["status"] = {
  kind: "answered",
  changed: false,
  results: results({ voters: 3 }),
};
const base: VoteCardProps = {
  question: "What should we build?",
  why: "Closes Wednesday.",
  method: "single",
  choices: [
    { index: 0, label: "No" },
    { index: 1, label: "Yes" },
  ],
  picked: [1],
  status: ANSWERED,
  privacyNote: "Your answer is private.",
  collapsed: false,
  onPick: vi.fn(),
  onSubmit: vi.fn(),
  onCollapse: vi.fn(),
  onClose: vi.fn(),
};
const note = () => screen.getByRole("status").textContent;
const confirmLink = () =>
  screen.queryByRole("link", { name: /Confirm with your email/ });

describe("what the card says about a counted vote", () => {
  it("words each state, and a replacement after it", () => {
    expect(countedNote(false, "unknown")).toBe("Counted");
    expect(countedNote(false, "offer")).toBe("Counted");
    expect(countedNote(false, "confirmed")).toBe(
      "Counted · confirmed by email",
    );
    expect(countedNote(true, "confirmed")).toBe(
      "Counted · confirmed by email. That replaces your earlier answer.",
    );
  });

  it("says only Counted, and offers nothing, while it cannot tell", () => {
    render(<VoteCard {...base} confirmHref="/sign-in?poll=p" />);
    expect(note()).toBe("Counted");
    expect(confirmLink()).toBeNull();
  });

  it("offers to confirm, in a new tab, when nobody is signed in", () => {
    render(
      <VoteCard {...base} confirmation="offer" confirmHref="/sign-in?poll=p" />,
    );
    expect(note()).toBe("Counted");
    const link = confirmLink();
    expect(link?.getAttribute("href")).toBe("/sign-in?poll=p");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
  });

  it("says confirmed by email, with nothing to press, when signed in", () => {
    render(
      <VoteCard
        {...base}
        confirmation="confirmed"
        confirmHref="/sign-in?poll=p"
      />,
    );
    expect(note()).toBe("Counted · confirmed by email");
    expect(confirmLink()).toBeNull();
  });

  it("never says verified", () => {
    render(
      <VoteCard
        {...base}
        confirmation="confirmed"
        trustHref="/trust"
        status={{
          ...ANSWERED,
          results: results({ voters: 3, confirmedVoters: 1 }),
        }}
      />,
    );
    expect((document.body.textContent ?? "").toLowerCase()).not.toContain(
      "verif",
    );
  });

  it("keeps the vote's status when fresh results fail, and can ask again", async () => {
    const onRetry = vi.fn();
    render(
      <VoteCard
        {...base}
        confirmation="confirmed"
        resultsProblem={{ message: "We could not load the results.", onRetry }}
      />,
    );
    expect(note()).toBe("Counted · confirmed by email");
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not load the results.",
    );
    expect(screen.queryByText(/votes so far/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("signing in while a counted vote is on screen", () => {
  const p = poll();
  function counts(confirmedVoters: number): Results {
    return results({
      pollId: p.id,
      voters: 1,
      confirmedVoters,
      choices: p.choices.map((label, index) => ({
        index,
        label,
        count: index === 1 ? 1 : 0,
        share: index === 1 ? 100 : 0,
        confirmedCount: index === 1 ? confirmedVoters : 0,
        confirmedShare: index === 1 && confirmedVoters ? 100 : 0,
      })),
    });
  }
  async function vote() {
    const user = userEvent.setup();
    const main = within(await screen.findByRole("main"));
    await user.click(await main.findByRole("button", { name: "Vote" }));
    await user.click(main.getByRole("radio", { name: p.choices[1]! }));
    await user.click(main.getByRole("button", { name: "Submit" }));
    await main.findByText(/^Counted/);
    return main;
  }
  function cast() {
    return Promise.resolve({
      status: "counted" as const,
      ballot: [1],
      results: counts(0),
    });
  }

  it("links Confirm to sign-in for this question", async () => {
    render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
    const main = await vote();
    expect(
      main
        .getByRole("link", { name: /Confirm with your email/ })
        .getAttribute("href"),
    ).toBe(`/sign-in?poll=${p.id}`);
    expect(main.getByText("1 vote so far · 0 confirmed by email")).toBeTruthy();
  });

  it("turns confirmed, with the new numbers, when the page is come back to", async () => {
    let me: Me | null = null;
    const fetched = vi.fn(() => Promise.resolve(counts(1)));
    render(
      <Conversation
        api={stubApi({
          cast,
          me: () => Promise.resolve(me),
          results: fetched,
        })}
        pollId={p.id}
      />,
    );
    const main = await vote();
    // Signed in in another tab: this page only learns when it is looked at.
    me = ME;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await main.findByText("Counted · confirmed by email")).toBeTruthy();
    expect(
      await main.findByText("1 vote so far · 1 confirmed by email"),
    ).toBeTruthy();
    expect(fetched).toHaveBeenCalledWith(p.id);
    expect(main.queryByRole("link", { name: /Confirm with your email/ })).toBe(
      null,
    );
  });

  it("turns confirmed when another tab announces a sign-in, without focus", async () => {
    let me: Me | null = null;
    render(
      <Conversation
        api={stubApi({
          cast,
          me: () => Promise.resolve(me),
          results: () => Promise.resolve(counts(1)),
        })}
        pollId={p.id}
      />,
    );
    const main = await vote();
    me = ME;
    // Some other key changing says nothing about signing in.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    });
    await new Promise((done) => setTimeout(done, 20));
    expect(main.getByRole("status").textContent).toBe("Counted");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_IN_KEY }));
    });
    expect(await main.findByText("Counted · confirmed by email")).toBeTruthy();
    expect(
      await main.findByText("1 vote so far · 1 confirmed by email"),
    ).toBeTruthy();
  });

  it("keeps the status and says so when the new numbers fail", async () => {
    let me: Me | null = null;
    const { ApiError } = await import("../src/api/types.js");
    const fetched = vi
      .fn<(id: string) => Promise<Results>>()
      .mockRejectedValueOnce(
        new ApiError(503, "Results are not available.", "unavailable"),
      )
      .mockResolvedValue(counts(1));
    render(
      <Conversation
        api={stubApi({
          cast,
          me: () => Promise.resolve(me),
          results: fetched,
        })}
        pollId={p.id}
      />,
    );
    const main = await vote();
    me = ME;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((await main.findByRole("alert")).textContent).toBe(
      "Results are not available.",
    );
    expect(main.getByRole("status").textContent).toBe(
      "Counted · confirmed by email",
    );
    await userEvent.click(main.getByRole("button", { name: "Try again" }));
    expect(
      await main.findByText("1 vote so far · 1 confirmed by email"),
    ).toBeTruthy();
    expect(main.queryByRole("alert")).toBeNull();
  });

  it("does not ask again once someone is signed in", async () => {
    const me = vi.fn(() => Promise.resolve(ME));
    render(<Conversation api={stubApi({ cast, me })} pollId={p.id} />);
    const main = await vote();
    expect(main.getByRole("status").textContent).toBe(
      "Counted · confirmed by email",
    );
    const asked = me.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(me.mock.calls.length).toBe(asked));
  });
});
