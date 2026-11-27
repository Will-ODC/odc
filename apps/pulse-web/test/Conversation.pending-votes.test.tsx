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
import type { Ballot, CastOutcome } from "../src/api/types.js";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, stubApi } from "./stub-api.js";
import {
  main,
  said,
  card,
  openCard,
  banner,
  openAccount,
  rail,
  voteLinks,
  fromServer,
  elapse,
} from "./conversation-fixtures.js";
import { tally } from "./pulse-server.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

describe("the Answered list (#484)", () => {
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
    await main().findByText(said("You picked No."));
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
    await main().findByText(said("You picked Yes."));
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
        "button",
        { name: "Change my answer" },
      ),
    );
    await user.click(within(card()).getByRole("radio", { name: "No" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    view.rerender(<Conversation api={api} pollId={parks.id} />);
    await main().findByRole("heading", { name: parks.question, level: 1 });
    await act(async () =>
      finish({ status: "changed", ballot: [0], results: tally(first, [0]) }),
    );
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await main().findByText(said("You picked No."));
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
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
    await main().findByText(said("You picked Yes."));
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
        "button",
        { name: "Change my answer" },
      ),
    );
    await user.click(within(card()).getByRole("radio", { name: "No" }));
    await user.click(within(card()).getByRole("button", { name: "Submit" }));
    view.rerender(<Conversation api={api} pollId="missing" />);
    await main().findByText(/Couldn't reach pulse/);
    expect(
      rail()
        .getByRole("link", { name: first.question })
        .getAttribute("aria-disabled"),
    ).toBeNull();
    // The answer being replaced is not claimed while its change is unsettled.
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
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
    // One way to change an answer: the drawer's handle (#478).
    await user.click(
      within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
        "button",
        { name: "Change my answer" },
      ),
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
    await main().findByText(said("You picked Yes."));
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
    await main().findByText(said("You picked No."));
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
    await main().findByText(said("You picked Yes."));
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
    await main().findByText(said("You picked No."));
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
    await main().findByText(said("You picked Yes."));
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
    await main().findByText(said("You picked No."));
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
    await main().findByText(said("You picked Yes."));
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
    await main().findByText(said("You picked Yes."));
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
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
    expect(myBallot).not.toHaveBeenCalled();
    await act(async () =>
      sends.finish({
        status: "changed",
        ballot: [0],
        results: tally(first, [0]),
      }),
    );
    await main().findByText(said("You picked No."));
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
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
    await main().findByText(said("You picked Yes."));
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
      expect(main().queryByText(said("You picked Yes."))).toBeNull();
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
      main().getByText(said("You picked No."));
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
    await main().findByText(said("You picked Yes."));
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
    expect(main().queryByText(said("You picked Yes."))).toBeNull();
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
      await within(card()).findByRole("button", { name: "Next question" }),
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
});
