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
import type { Ballot, CastOutcome, MyVotesPage } from "../src/api/types.js";
import { App } from "../src/App.js";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, stubApi } from "./stub-api.js";
import {
  main,
  said,
  card,
  openCard,
  answer,
  banner,
  openAccount,
  rail,
  voteLinks,
  fromServer,
  elapse,
  castYes,
} from "./conversation-fixtures.js";

import { tally } from "./pulse-server.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

describe("the Answered list (#484)", () => {
  it("starts from this browser's saved answers and adds a new one on top", async () => {
    render(
      <Conversation
        api={stubApi({
          cast: castYes,
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

  it("says a question that has closed since My votes was read is closed (#575)", async () => {
    // The row was read while the question was open; it has closed since.
    const closedSince = {
      ...fromServer,
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    };
    render(
      <Conversation
        api={stubApi({
          myVotes: async () => ({ votes: [closedSince], nextCursor: null }),
        })}
        pollId="ads-free"
      />,
    );
    await rail().findByRole("link", { name: "More parks?" });
    expect(rail().getByText("Closed · View results")).toBeTruthy();
    expect(rail().queryByText(/You can change your answer/)).toBeNull();
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
    expect(main().getByText(said("You picked No."))).toBeTruthy();
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
    await main().findByText(said("You picked Yes."));
    const drawer = within(
      screen.getByRole("complementary", { name: "Voting" }),
    );
    const user = userEvent.setup();
    await user.click(drawer.getByRole("button", { name: "Change my answer" }));
    await user.click(drawer.getByRole("radio", { name: "No" }));
    await user.click(drawer.getByRole("button", { name: "Submit" }));
    await main().findByText(said("You picked No."));
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

  it("pushes Next and reopens an address-named rail question without pushing it again", async () => {
    const first = poll({ next: [null, "parks"] });
    const parks = poll({ id: "parks", question: "More parks?" });
    const onNavigate = vi.fn();
    render(
      <Conversation
        api={stubApi({ cast: castYes, poll: graph([first, parks]) })}
        pollId={first.id}
        onNavigate={onNavigate}
      />,
    );
    await main().findByRole("heading", { name: first.question, level: 1 });
    const user = await answer("Yes");
    await user.click(
      within(card()).getByRole("button", { name: "Next question" }),
    );
    await main().findByRole("heading", { name: parks.question, level: 1 });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith({
      kind: "conversation",
      pollId: parks.id,
    });
    await user.click(rail().getByRole("link", { name: first.question }));
    await main().findByRole("heading", { name: first.question, level: 1 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
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
    expect(retry.classList.contains("btn--small")).toBe(true);
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
    render(
      <Conversation
        api={stubApi({ cast: castYes, myVotes })}
        pollId="ads-free"
      />,
    );
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
          cast: castYes,
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
          cast: castYes,
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
    // This visit's answer stays listed in the rail (no thread since #478).
    expect(rail().getByRole("link", { name: poll().question })).toBeTruthy();

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

  it("does not read out an old rail retry after the votes are forgotten", async () => {
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockResolvedValue({ votes: [fromServer], nextCursor: null });
    render(
      <Conversation
        api={stubApi({ cast: castYes, myVotes, signOut: async () => {} })}
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
      expect(main().queryByText(said("You picked No."))).toBeNull();
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
    let finishRetry!: (page: MyVotesPage) => void;
    const myVotes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockImplementationOnce(
        () => new Promise<MyVotesPage>((resolve) => (finishRetry = resolve)),
      );
    render(<Conversation api={stubApi({ myVotes })} pollId="ads-free" />);
    // Initial question focus is independent of the rail's failed read.
    const heading = await main().findByRole("heading", {
      name: poll().question,
      level: 1,
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await userEvent.click(
      await rail().findByRole("button", { name: "Try again" }),
    );
    const myVotesLink = rail().getByRole("link", { name: "My votes" });
    await waitFor(() => expect(document.activeElement).toBe(myVotesLink));
    expect(rail().getByRole("status").textContent).toContain("Loading…");
    await act(async () =>
      finishRetry({ votes: [fromServer], nextCursor: null }),
    );
    await rail().findByRole("link", { name: "More parks?" });
    await waitFor(() => expect(document.activeElement).toBe(myVotesLink));
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
