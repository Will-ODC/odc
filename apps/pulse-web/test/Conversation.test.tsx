// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, UNREACHABLE } from "../src/api/types.js";
import type { Ballot, CastOutcome } from "../src/api/types.js";
import { closingNote } from "../src/flow/conversation.js";
import { Conversation } from "../src/screens/Conversation.js";
import { pulseServer, tally } from "./pulse-server.js";
import { graph, poll, results, stubApi } from "./stub-api.js";
import {
  main,
  said,
  card,
  openCard,
  answer,
  castYes,
} from "./conversation-fixtures.js";

afterEach(cleanup);
// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../src/components/BarChart.js"));

it("links a counted vote to the trust page (#351)", async () => {
  render(<Conversation api={stubApi({ cast: castYes })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  openCard();
  expect(
    within(card()).queryByRole("link", { name: /How votes count/ }),
  ).toBeNull();
  await answer();
  expect(
    within(card())
      .getByRole("link", { name: /How votes count/ })
      .getAttribute("href"),
  ).toBe("/trust");
});
it("opens the first question expanded without selecting or sending an answer", async () => {
  const cast = vi.fn();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  const heading = await main().findByRole("heading", {
    name: poll().question,
    level: 1,
  });
  expect(
    heading.nextElementSibling?.contains(
      main().getByRole("button", { name: /Copy link to/ }),
    ),
  ).toBe(true);
  expect(main().queryByRole("img")).toBeNull();
  // No "Message" box until an assistant exists (walkthrough, 2026-10-21).
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByText(/assistant is not available/)).toBeNull();
  expect(within(card()).getByRole("group")).toBeTruthy();
  expect(
    within(card())
      .getAllByRole("radio")
      .every((input) => !(input as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(card()).getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(main().queryByRole("button", { name: "Vote" })).toBeNull();
  expect(cast).not.toHaveBeenCalled();
});

it("keeps a manually closed card closed and preserves its unsent pick on reopen", async () => {
  const cast = vi.fn();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  // Closing leaves a handle in the drawer, and focus on it.
  expect(document.activeElement).toBe(
    within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
      "button",
      { name: "Vote" },
    ),
  );
  await user.click(main().getByRole("heading", { name: poll().question }));
  expect(main().queryByRole("region")).toBeNull();
  await user.click(main().getByRole("button", { name: "Vote" }));
  expect(within(card()).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(document.activeElement).toBe(
    within(card()).getByRole("radio", { name: "Yes" }),
  );
  expect(cast).not.toHaveBeenCalled();
});
it("shows loading, empty and errors with a working retry", async () => {
  const fetchPoll = vi.fn().mockImplementationOnce(() => new Promise(() => {}));
  const { unmount } = render(
    <Conversation api={stubApi({ poll: fetchPoll })} pollId="missing" />,
  );
  expect(main().getByText("Loading…")).toBeTruthy();
  unmount();
  fetchPoll
    .mockRejectedValueOnce(new ApiError(404, "Missing"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(poll());
  render(<Conversation api={stubApi({ poll: fetchPoll })} pollId="missing" />);
  expect(
    await screen.findByText("There is nothing to vote on yet."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/Couldn't reach pulse/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await main().findByRole("heading", { name: poll().question, level: 1 }),
  ).toBeTruthy();
});
it("puts one results banner after the question and before the thread, with voting in the drawer", async () => {
  const p = poll();
  let attempt = 0;
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: attempt++ === 0 ? "counted" : "changed",
      ballot,
      results: tally(p, ballot),
    }),
  );
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  expect(within(drawer).getByRole("button", { name: "Submit" })).toBeTruthy();
  const user = await answer();
  const standing = main().getByRole("group", { name: "How people answered" });
  const answerRow = main().getByText(said("You picked Yes."));
  const heading = main().getByRole("heading", { name: p.question, level: 1 });
  expect(
    heading.compareDocumentPosition(standing) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    // The answer leads, then the results (#478).
    answerRow.compareDocumentPosition(standing) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    main().getAllByRole("group", { name: "How people answered" }),
  ).toHaveLength(1);
  expect(standing.classList.contains("results--compact")).toBe(true);
  expect(
    within(drawer).queryByRole("group", { name: "How people answered" }),
  ).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(standing));
  expect(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  ).toBeTruthy();
  expect(within(drawer).queryByRole("button", { name: "Vote" })).toBeNull();
  // One way to change an answer: the drawer's handle (#478).
  expect(
    within(card()).queryByRole("button", { name: "Change my answer" }),
  ).toBeNull();
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  expect(within(drawer).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(document.activeElement).toBe(
    within(drawer).getByRole("radio", { name: "Yes" }),
  );
  await user.click(within(drawer).getByRole("radio", { name: "No" }));
  await user.click(within(drawer).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(await main().findByText(said("You picked No."))).toBeTruthy();
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  expect(within(drawer).getByRole("button", { name: "Submit" })).toBeTruthy();
  expect(cast).toHaveBeenCalledTimes(2);
});

it("keeps the saved answer and its results when backing out of a change", async () => {
  const p = poll();
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }),
  );
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  const user = await answer();
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  await user.click(within(drawer).getByRole("radio", { name: "No" }));
  await user.click(within(drawer).getByRole("button", { name: "Close" }));
  const handle = within(drawer).getByRole("button", {
    name: "Change my answer",
  });
  expect(document.activeElement).toBe(handle);
  expect(main().getByText(said("You picked Yes."))).toBeTruthy();
  // One results banner above the thread (#453), still showing the saved answer.
  const standing = main().getByRole("group", {
    name: "How people answered",
  });
  expect(
    (await within(standing).findByRole("rowheader", { name: /\(yours\)/ }))
      .textContent,
  ).toMatch(/Yes/);
  expect(cast).toHaveBeenCalledExactlyOnceWith(p.id, [1]);
  // Reopening starts from the saved choice, not the unsent one.
  await user.click(handle);
  expect(within(drawer).getByRole("radio", { name: "Yes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(within(drawer).getByRole("radio", { name: "No" })).toHaveProperty(
    "checked",
    false,
  );
});

it.each([
  {
    failure: "a refusal",
    error: new ApiError(409, "That did not go through."),
    restores: true,
  },
  {
    failure: "a lost connection",
    error: new Error("offline"),
    restores: false,
  },
])(
  "after $failure, closing a change restores the saved answer only if the server refused",
  async ({ error, restores }) => {
    const p = poll();
    const cast = vi
      .fn()
      .mockResolvedValueOnce({
        status: "counted",
        ballot: [1],
        results: tally(p, [1]),
      })
      .mockRejectedValueOnce(error);
    render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
    await main().findByRole("heading", { name: p.question, level: 1 });
    const user = await answer();
    const drawer = screen.getByRole("complementary", { name: "Voting" });
    await user.click(
      within(drawer).getByRole("button", { name: "Change my answer" }),
    );
    await user.click(within(drawer).getByRole("radio", { name: "No" }));
    await user.click(within(drawer).getByRole("button", { name: "Submit" }));
    await within(drawer).findByRole("alert");
    await user.click(within(drawer).getByRole("button", { name: "Close" }));
    const results = main().queryByRole("group", {
      name: "How people answered",
    });
    if (restores) {
      expect(results).not.toBeNull();
      expect(
        within(drawer).getByRole("button", { name: "Change my answer" }),
      ).toBeTruthy();
    } else {
      // The new answer may have been stored, and the server could not say:
      // show no counts that claim Yes, and keep the sheet open saying so.
      expect(results).toBeNull();
      const alert = await within(drawer).findByRole("alert");
      expect(alert.textContent).toBe(UNREACHABLE);
      const close = within(drawer).getByRole("button", { name: "Close" });
      await waitFor(() => expect(document.activeElement).toBe(close));
    }
  },
);

it("on a phone, Close after a lost reply asks the server and shows the answer it stored (#527)", async () => {
  const p = poll();
  const server = pulseServer(p);
  const user = userEvent.setup();
  render(<Conversation api={server.api} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  await user.click(within(drawer).getByRole("radio", { name: "Yes" }));
  await user.click(within(drawer).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  await user.click(
    within(drawer).getByRole("button", { name: "Change my answer" }),
  );
  await user.click(within(drawer).getByRole("radio", { name: "No" }));
  server.dropNextSend();
  server.asked.length = 0;
  await user.click(within(drawer).getByRole("button", { name: "Submit" }));
  expect((await within(drawer).findByRole("alert")).textContent).toBe(
    UNREACHABLE,
  );
  await user.click(within(drawer).getByRole("button", { name: "Close" }));
  // The send was stored: Close asks, and the page shows No, not a bare Vote.
  await main().findByText(said("You picked No."));
  expect(server.asked).toContain(`GET /api/polls/${p.id}/ballot`);
  const handle = within(drawer).getByRole("button", {
    name: "Change my answer",
  });
  await waitFor(() => expect(document.activeElement).toBe(handle));
  expect(within(drawer).queryByRole("button", { name: "Vote" })).toBeNull();
}, 15_000);

it("names the closed question's handle Show question, not Vote", async () => {
  const p = poll({ open: false });
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        results: async () => results(),
        myBallot: async () => null,
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  const drawer = screen.getByRole("complementary", { name: "Voting" });
  expect(within(drawer).queryByRole("button", { name: "Vote" })).toBeNull();
  const handle = within(drawer).getByRole("button", { name: "Show question" });
  expect(document.activeElement).toBe(handle);
  await user.click(handle);
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
});

it("opens the next question's card even if the previous card was closed (#401)", async () => {
  const p = poll({ next: [null, "second"] });
  const second = poll({ id: "second", question: "Where?", next: [null, null] });
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }),
  );
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({ poll: graph([p, second]), cast })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  await user.click(
    within(card()).getByRole("button", { name: "Next question" }),
  );
  await main().findByRole("heading", { name: second.question, level: 1 });
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(main().queryByRole("region")).toBeNull();
  await user.click(
    within(screen.getByRole("navigation", { name: "My votes" })).getByRole(
      "link",
      { name: p.question },
    ),
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(main().queryByRole("region")).not.toBeNull();
});
it("sends every approval pick, follows its lowest-index edge, and retains the conversation", async () => {
  const p = poll({
    method: "approval",
    choices: ["Park", "Library", "Rink"],
    next: ["second", "wrong", null],
  });
  const second = poll({
    id: "second",
    question: "Where should it go?",
    next: [null, null],
  });
  const cast = vi.fn(
    async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
      status: "counted",
      ballot: [...ballot].sort(),
      results: tally(p, ballot),
    }),
  );
  render(
    <Conversation
      api={stubApi({ poll: graph([p, second]), cast })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("checkbox", { name: "Library" }));
  await user.click(within(card()).getByRole("checkbox", { name: "Park" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  await main().findByText("Counted");
  expect(cast).toHaveBeenCalledExactlyOnceWith(p.id, [1, 0]);
  expect(
    await within(card()).findAllByRole("rowheader", { name: /\(yours\)/ }),
  ).toHaveLength(2);
  await user.click(
    within(card()).getByRole("button", { name: "Next question" }),
  );
  expect(
    await main().findByRole("heading", { name: second.question, level: 1 }),
  ).toBeTruthy();
  // The earlier answer is in the Answered list, not under the results (#478).
  expect(
    within(screen.getByRole("navigation", { name: "My votes" })).getByText(
      "Your answer: Park, Library",
    ),
  ).toBeTruthy();
  expect(within(card()).getByRole("group")).toBeTruthy();
  expect(
    within(card())
      .getAllByRole("radio")
      .every((input) => !(input as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(card()).getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(cast).toHaveBeenCalledOnce();
  await user.click(
    within(screen.getByRole("navigation", { name: "My votes" })).getByRole(
      "link",
      { name: p.question },
    ),
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  expect(
    within(card()).getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
  expect(cast).toHaveBeenCalledOnce();
});
it("does not show Next when the steering choice ends the run", async () => {
  const p = poll({ next: [null, "elsewhere"] });
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        cast: async (_id, ballot) => ({
          status: "counted",
          ballot,
          results: tally(p, ballot),
        }),
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  await answer("No");
  expect(
    within(card()).queryByRole("button", { name: "Next question" }),
  ).toBeNull();
});
it("refuses a known closed poll and lets a non-voter read final results", async () => {
  const p = poll({ open: false });
  const cast = vi.fn();
  render(
    <Conversation
      api={stubApi({
        poll: async () => p,
        cast,
        results: async () => results(),
        myBallot: async () => null,
      })}
      pollId={p.id}
    />,
  );
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.click(main().getByRole("button", { name: "See results" }));
  expect(await main().findByText("Nobody answered this one.")).toBeTruthy();
  const standing = main().getByRole("group", { name: "How people answered" });
  expect(standing.classList.contains("results--compact")).toBe(true);
  expect(
    screen.getByRole("complementary", { name: "Voting" }).contains(standing),
  ).toBe(false);
  // Hiding keeps one line and the button that brings them back (#478).
  const hide = within(standing).getByRole("button", { name: "Hide results" });
  expect(hide.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(hide);
  expect(document.activeElement).toBe(hide);
  expect(hide.textContent).toBe("Show results");
  expect(hide.getAttribute("aria-expanded")).toBe("false");
  expect(within(standing).getByText("Nobody answered this one.")).toBeTruthy();
  expect(within(card()).getByText("This one has closed.")).toBeTruthy();
  expect(cast).not.toHaveBeenCalled();
});
it("handles a poll closing during submit without offering another cast", async () => {
  const cast = vi.fn(async () => ({ status: "closed" as const }));
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  const note = main().getByText(closingNote(poll()));
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await main().findByText("This one has closed.")).toBeTruthy();
  expect(within(card()).queryByRole("button", { name: "Submit" })).toBeNull();
  expect(main().getByText("This question has closed.")).toBe(note);
  expect(main().queryByText(closingNote(poll()))).toBeNull();
  expect(cast).toHaveBeenCalledOnce();
});
it("a failed send keeps the picks for retry", async () => {
  const p = poll();
  const cast = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(503, "Try later."))
    .mockImplementation(async (_id: string, ballot: Ballot) => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }));
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  const user = userEvent.setup();
  await user.click(within(card()).getByRole("radio", { name: "Yes" }));
  await user.click(within(card()).getByRole("button", { name: "Submit" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Try later.",
  );
  await user.click(within(card()).getByRole("button", { name: "Try again" }));
  await main().findByText("Counted");
  expect(cast).toHaveBeenLastCalledWith(p.id, [1]);
});
it("keyboard-only picking and confirmation casts exactly once", async () => {
  let release: ((value: CastOutcome) => void) | undefined;
  const cast = vi.fn(
    () =>
      new Promise<CastOutcome>((resolve) => {
        release = resolve;
      }),
  );
  render(<Conversation api={stubApi({ cast })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  const user = userEvent.setup();
  await user.tab(); // Copy link, under the question
  await user.tab(); // Close
  await user.tab(); // First choice
  expect(document.activeElement).toBe(
    main().getByRole("radio", { name: "No" }),
  );
  await user.keyboard("2");
  await user.tab();
  await user.keyboard("{Enter}{Enter}");
  await waitFor(() =>
    expect(cast).toHaveBeenCalledExactlyOnceWith("ads-free", [1]),
  );
  expect(document.activeElement?.textContent).toBe("Sending…");
  release?.({ status: "counted", ballot: [1], results: tally(poll(), [1]) });
  await main().findByText("Counted");
});

it("retrying a failed replacement sends the new choice rather than the prior answer", async () => {
  const p = poll();
  const cast = vi
    .fn()
    .mockImplementationOnce(async (_id: string, ballot: Ballot) => ({
      status: "counted",
      ballot,
      results: tally(p, ballot),
    }))
    .mockRejectedValueOnce(new ApiError(503, "Try later."))
    .mockImplementationOnce(async (_id: string, ballot: Ballot) => ({
      status: "changed",
      ballot,
      results: tally(p, ballot),
    }));
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  openCard();
  const user = await answer("Yes");
  await user.click(
    within(screen.getByRole("complementary", { name: "Voting" })).getByRole(
      "button",
      { name: "Change my answer" },
    ),
  );
  await user.keyboard("1");
  await user.tab();
  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  expect(
    (within(card()).getByRole("radio", { name: "No" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await user.keyboard("{Enter}");
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  // The transcript line catches up after the card; wait for it (raced on CI).
  expect(await main().findByText(said("You picked No."))).toBeTruthy();
});

it("keeps the closing note in the same page node when voting opens and closes", async () => {
  const p = poll({ closesAt: "2030-05-01T12:00:00.000Z" });
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  const heading = await main().findByRole("heading", {
    name: p.question,
    level: 1,
  });
  const hero = heading.parentElement!;
  const note = within(hero).getByText(closingNote(p));
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);
  expect(within(card()).queryByText(closingNote(p))).toBeNull();
  await user.click(within(card()).getByRole("button", { name: "Close" }));
  expect(within(hero).getByText(closingNote(p))).toBe(note);
  await user.click(main().getByRole("button", { name: "Vote" }));
  expect(within(hero).getByText(closingNote(p))).toBe(note);
  expect(screen.getAllByText(closingNote(p))).toHaveLength(1);
  expect(main().getByRole("heading", { name: p.question, level: 1 })).toBe(
    heading,
  );
});

it("leaves out the 'Opens another question' hint under choices", async () => {
  const p = poll({ next: ["parks", null] });
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(within(card()).getByRole("radio", { name: "No" })).toBeTruthy();
  expect(screen.queryByText("Opens another question")).toBeNull();
});

it("links to /trust once after voting, as 'How votes count'", async () => {
  render(<Conversation api={stubApi({ cast: castYes })} pollId="ads-free" />);
  await main().findByRole("heading", { name: poll().question, level: 1 });
  await answer();
  const links = within(card())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href") === "/trust");
  expect(links).toHaveLength(1);
  expect(links[0]?.textContent).toBe("i");
  // First in the results' footer, now that Change my answer is the drawer's.
  expect(links[0]?.previousElementSibling).toBeNull();
  expect(main().queryByText("Only you can see your answer here.")).toBeNull();
  expect(main().queryByText("WHERE IT STANDS")).toBeNull();
  expect(main().queryByRole("button", { name: "Show me how" })).toBeNull();
  expect(screen.queryByText(/What does this mean\?/)).toBeNull();
});

describe("the results after voting (#478, #480)", () => {
  it("leads with the answer and offers a short Sign in to confirm", async () => {
    render(<Conversation api={stubApi({ cast: castYes })} pollId="ads-free" />);
    await main().findByRole("heading", { name: poll().question, level: 1 });
    await answer();
    expect(
      within(card()).getByText(
        (_, node) => node?.textContent === "You picked Yes.",
      ),
    ).toBeTruthy();
    const signIn = within(card()).getByRole("link", {
      name: "Sign in to confirm your vote (opens in a new tab)",
    });
    expect(signIn.textContent).toBe("Sign in");
    expect(signIn.getAttribute("target")).toBe("_blank");
    expect(within(card()).queryByText(/verif/i)).toBeNull();
  });

  it("minimizes the results to one line, keeps focus, and keeps it hidden through a change", async () => {
    const p = poll();
    let casts = 0;
    const cast = vi.fn(
      async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
        status: casts++ === 0 ? "counted" : "changed",
        ballot,
        results: tally(p, ballot),
      }),
    );
    render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
    await main().findByRole("heading", { name: p.question, level: 1 });
    const user = await answer();
    const results = () =>
      main().getByRole("group", { name: "How people answered" });
    const hide = within(results()).getByRole("button", {
      name: "Hide results",
    });
    const body = document.getElementById(hide.getAttribute("aria-controls")!);
    expect(body?.hidden).toBe(false);
    await user.click(hide);
    expect(document.activeElement).toBe(hide);
    expect(hide.getAttribute("aria-expanded")).toBe("false");
    expect(within(results()).getByText("1 vote so far")).toBeTruthy();
    expect(within(results()).queryByText(/confirmed by email/)).toBeNull();

    const drawer = screen.getByRole("complementary", { name: "Voting" });
    await user.click(
      within(drawer).getByRole("button", { name: "Change my answer" }),
    );
    await user.click(within(drawer).getByRole("radio", { name: "No" }));
    await user.click(within(drawer).getByRole("button", { name: "Submit" }));
    await main().findByText("Counted. That replaces your earlier answer.");
    expect(cast).toHaveBeenCalledTimes(2);
    const show = within(results()).getByRole("button", {
      name: "Show results",
    });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    show.focus();
    await user.keyboard("{Enter}");
    expect(show.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(results()).getByText("1 vote so far · 0 confirmed by email"),
    ).toBeTruthy();
  });
});
