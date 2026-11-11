// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MyVote, MyVotesPage, Poll } from "../src/api/types.js";
import { App } from "../src/App.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
beforeAll(() => import("../src/components/BarChart.js"));

const first = poll({ id: "first", question: "Build the first park?" });
const middle = poll({ id: "middle", question: "Open the library later?" });
const third = poll({
  id: "third",
  question: "Add a protected bike lane?",
  open: false,
});

const saved = (question: Poll, castAt: string): MyVote => ({
  pollId: question.id,
  question: question.question,
  choices: [question.choices[1]!],
  ballot: [1],
  castAt,
  closesAt: question.closesAt,
  open: question.open,
});

const votes = [
  saved(first, "2026-11-11T03:00:00.000Z"),
  saved(middle, "2026-11-11T02:00:00.000Z"),
  saved(third, "2026-11-11T01:00:00.000Z"),
];

const answerResults = (question: Poll) =>
  results({
    pollId: question.id,
    question: question.question,
    choices: question.choices.map((label, index) => ({
      index,
      label,
      count: index === 1 ? 1 : 0,
      share: index === 1 ? 100 : 0,
    })),
    voters: 1,
  });

function show(
  pollId: string,
  page: (cursor?: string) => Promise<MyVotesPage>,
  polls: Poll[] = [first, middle, third],
  over = {},
) {
  history.replaceState(null, "", `/?poll=${pollId}`);
  return render(
    <App
      api={stubApi({
        myVotes: page,
        poll: graph(polls),
        myBallot: async (id) =>
          votes.some((vote) => vote.pollId === id) ? [1] : null,
        results: async (id) =>
          answerResults(polls.find((one) => one.id === id)!),
        ...over,
      })}
    />,
  );
}

const main = () => within(screen.getByRole("main"));
const rail = () => within(screen.getByRole("navigation", { name: "My votes" }));

it("opens the My votes rows above and below the middle question and follows them in history", async () => {
  show(middle.id, async () => ({ votes, nextCursor: null }));
  const user = userEvent.setup();
  await main().findByRole("heading", { name: middle.question, level: 1 });

  await user.click(
    await main().findByRole("button", {
      name: `Previous question: ${first.question}`,
    }),
  );
  await main().findByRole("heading", { name: first.question, level: 1 });
  expect(location.search).toBe("?poll=first");
  expect(
    rail()
      .getByRole("link", { name: first.question })
      .getAttribute("aria-current"),
  ).toBe("page");

  act(() => history.back());
  await waitFor(() => expect(location.search).toBe("?poll=middle"));
  await main().findByRole("heading", { name: middle.question, level: 1 });
  const next = main().getByRole("button", {
    name: `Next question: ${third.question}`,
  });
  next.focus();
  await user.keyboard("{Enter}");
  await main().findByRole("heading", { name: third.question, level: 1 });
  expect(location.search).toBe("?poll=third");
  expect(
    rail()
      .getByRole("link", { name: third.question })
      .getAttribute("aria-current"),
  ).toBe("page");
});

it("disables both ends and gives enabled controls the target question's name", async () => {
  show(first.id, async () => ({ votes, nextCursor: null }));
  const user = userEvent.setup();
  await main().findByRole("heading", { name: first.question, level: 1 });

  expect(
    (await main().findByRole("button", {
      name: "No previous question",
    })) as HTMLButtonElement,
  ).toHaveProperty("disabled", true);
  await user.click(
    main().getByRole("button", {
      name: `Next question: ${middle.question}`,
    }),
  );
  await user.click(
    await main().findByRole("button", {
      name: `Next question: ${third.question}`,
    }),
  );
  await main().findByRole("heading", { name: third.question, level: 1 });
  expect(
    main().getByRole("button", { name: "No next question" }),
  ).toHaveProperty("disabled", true);
  expect(
    main().getByRole("button", {
      name: `Previous question: ${middle.question}`,
    }),
  ).toHaveProperty("disabled", false);
});

it("keeps answer-selected Next and has no Previous for a question that was not in My votes", async () => {
  const unanswered = poll({
    id: "unanswered",
    question: "Plant more street trees?",
    next: [null, third.id],
  });
  show(
    unanswered.id,
    async () => ({ votes: [votes[0]!], nextCursor: null }),
    [unanswered, first, third],
    {
      cast: async () => ({
        status: "counted" as const,
        ballot: [1],
        results: answerResults(unanswered),
      }),
    },
  );
  const user = userEvent.setup();
  await main().findByRole("heading", { name: unanswered.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));

  expect(
    main().queryByRole("button", { name: /Previous question/ }),
  ).toBeNull();
  await user.click(
    await main().findByRole("button", { name: "Next question" }),
  );
  await main().findByRole("heading", { name: third.question, level: 1 });
  expect(location.search).toBe("?poll=third");
});

it("loads another My votes page to find the current row and its next question", async () => {
  const myVotes = vi.fn(async (cursor?: string) =>
    cursor
      ? { votes: [votes[1]!, votes[2]!], nextCursor: null }
      : { votes: [votes[0]!], nextCursor: "older" },
  );
  show(middle.id, myVotes);
  const user = userEvent.setup();

  await waitFor(() => expect(myVotes).toHaveBeenCalledWith("older"));
  const next = await main().findByRole("button", {
    name: `Next question: ${third.question}`,
  });
  // The later page is read for the pager alone: the rail keeps its first
  // page and See all my votes.
  expect(
    rail().getByRole("link", { name: "See all my votes" }).getAttribute("href"),
  ).toBe("/my-votes");
  expect(rail().queryByRole("link", { name: third.question })).toBeNull();
  await user.click(next);
  await main().findByRole("heading", { name: third.question, level: 1 });
  expect(location.search).toBe("?poll=third");
});

it("moves a changed vote to the top before choosing its new My votes neighbors", async () => {
  show(middle.id, async () => ({ votes, nextCursor: null }), undefined, {
    cast: async () => ({
      status: "counted" as const,
      ballot: [0],
      results: answerResults(middle),
    }),
  });
  const user = userEvent.setup();
  await main().findByRole("heading", { name: middle.question, level: 1 });
  expect(
    await main().findByRole("button", {
      name: `Previous question: ${first.question}`,
    }),
  ).toHaveProperty("disabled", false);

  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Submit" }));

  expect(
    await main().findByRole("button", { name: "No previous question" }),
  ).toHaveProperty("disabled", true);
  expect(
    main().getByRole("button", {
      name: `Next question: ${first.question}`,
    }),
  ).toHaveProperty("disabled", false);
  expect(rail().getAllByRole("listitem")[0]?.textContent).toContain(
    middle.question,
  );
});

it("reads no more of My votes for an unanswered question, and the rail keeps See all my votes", async () => {
  const unanswered = poll({
    id: "unanswered",
    question: "Plant more street trees?",
    next: [null, third.id],
  });
  const myVotes = vi.fn(async (cursor?: string) =>
    cursor
      ? { votes: [votes[1]!, votes[2]!], nextCursor: null }
      : { votes: [votes[0]!], nextCursor: "older" },
  );
  show(unanswered.id, myVotes, [unanswered, first, middle, third], {
    cast: async () => ({
      status: "counted" as const,
      ballot: [1],
      results: answerResults(unanswered),
    }),
  });
  const user = userEvent.setup();
  await main().findByRole("heading", { name: unanswered.question, level: 1 });
  expect(
    await rail().findByRole("link", { name: "See all my votes" }),
  ).toBeTruthy();
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  expect(
    await main().findByRole("button", { name: "Next question" }),
  ).toBeTruthy();
  expect(myVotes).toHaveBeenCalledTimes(1);
  expect(rail().getByRole("link", { name: "See all my votes" })).toBeTruthy();
});

it("offers no Next of either kind while an older saved answer's neighbours are read", async () => {
  let finish!: (page: MyVotesPage) => void;
  const myVotes = vi.fn((cursor?: string) =>
    cursor
      ? new Promise<MyVotesPage>((resolve) => (finish = resolve))
      : Promise.resolve({ votes: [votes[0]!], nextCursor: "older" }),
  );
  const older = poll({
    id: "middle",
    question: middle.question,
    // The answer-selected Next would lead elsewhere.
    next: [first.id, first.id],
  });
  show(middle.id, myVotes, [first, older, third]);
  await waitFor(() => expect(myVotes).toHaveBeenCalledWith("older"));
  await main().findByRole("heading", { name: middle.question, level: 1 });
  expect(main().queryByRole("button", { name: /Next question/ })).toBeNull();
  expect(
    main().queryByRole("button", { name: /previous question/i }),
  ).toBeNull();

  act(() => finish({ votes: [votes[1]!, votes[2]!], nextCursor: null }));
  expect(
    await main().findByRole("button", {
      name: `Next question: ${third.question}`,
    }),
  ).toBeTruthy();
  expect(
    main().getByRole("button", {
      name: `Previous question: ${first.question}`,
    }),
  ).toBeTruthy();
});

it("gives a first answer the My votes pager once it is left and opened again", async () => {
  const unanswered = poll({
    id: "unanswered",
    question: "Plant more street trees?",
    next: [null, third.id],
  });
  show(
    unanswered.id,
    async () => ({ votes: [votes[0]!], nextCursor: null }),
    [unanswered, first, third],
    {
      cast: async () => ({
        status: "counted" as const,
        ballot: [1],
        results: answerResults(unanswered),
      }),
    },
  );
  const user = userEvent.setup();
  await main().findByRole("heading", { name: unanswered.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await user.click(
    await main().findByRole("button", { name: "Next question" }),
  );
  await main().findByRole("heading", { name: third.question, level: 1 });

  await user.click(rail().getByRole("link", { name: unanswered.question }));
  await main().findByRole("heading", { name: unanswered.question, level: 1 });
  expect(
    await main().findByRole("button", { name: "No previous question" }),
  ).toHaveProperty("disabled", true);
  expect(
    main().getByRole("button", { name: `Next question: ${first.question}` }),
  ).toHaveProperty("disabled", false);
});

function swipeLeft(over: HTMLElement) {
  const down = { identifier: 1, clientX: 300, clientY: 400 };
  const up = { identifier: 1, clientX: 180, clientY: 410 };
  fireEvent.touchStart(over, { touches: [down], changedTouches: [down] });
  fireEvent.touchMove(over, { touches: [up], changedTouches: [up] });
  fireEvent.touchEnd(over, { touches: [], changedTouches: [up] });
}

it("never swipes away from a change being made, but swipes from the results and a closed question", async () => {
  const closed = poll({
    id: "closed",
    question: "Close the old pool?",
    open: false,
  });
  const list = [
    votes[0]!,
    saved(closed, "2026-11-11T02:30:00.000Z"),
    votes[1]!,
  ];
  let send!: () => void;
  show(
    first.id,
    async () => ({ votes: list, nextCursor: null }),
    [first, closed, middle],
    {
      myBallot: async () => [1],
      cast: () =>
        new Promise((resolve) => {
          send = () =>
            resolve({
              status: "counted" as const,
              ballot: [0],
              results: answerResults(first),
            });
        }),
    },
  );
  const user = userEvent.setup();
  const heading = await main().findByRole("heading", {
    name: first.question,
    level: 1,
  });
  await main().findByRole("button", {
    name: `Next question: ${closed.question}`,
  });

  // The choices are open again: a swipe does not drop the change.
  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  swipeLeft(heading);
  expect(location.search).toBe("?poll=first");
  // Nor while it is being sent.
  await user.click(main().getByRole("button", { name: "Submit" }));
  swipeLeft(heading);
  expect(location.search).toBe("?poll=first");
  act(() => send());
  await main().findByRole("button", { name: "No previous question" });

  // From the results, a swipe opens the next row in My votes: now the first
  // row again after the change moved this question to the top.
  swipeLeft(main().getByRole("heading", { name: first.question, level: 1 }));
  await main().findByRole("heading", { name: closed.question, level: 1 });
  expect(location.search).toBe("?poll=closed");
  // A closed saved question swipes on to the row below it as well.
  await main().findByRole("button", {
    name: `Next question: ${middle.question}`,
  });
  swipeLeft(main().getByRole("heading", { name: closed.question, level: 1 }));
  await main().findByRole("heading", { name: middle.question, level: 1 });
  expect(location.search).toBe("?poll=middle");
});

describe("when a later My votes page cannot be read (#528)", () => {
  const j = poll({ id: "j", question: "Repaint the old bridge?" });
  const k = poll({ id: "k", question: "Light the river path?" });
  const y = poll({
    id: "y",
    question: "Move the farmers market?",
    // Where the answer-selected Next leads.
    next: [first.id, first.id],
  });
  const all = [first, j, k, y];
  const held = { myBallot: async () => [1] };
  const page1 = {
    votes: [votes[0]!, saved(j, "2026-11-11T02:50:00.000Z")],
    nextCursor: "older",
  };
  const page2 = {
    votes: [
      saved(k, "2026-11-11T02:40:00.000Z"),
      saved(y, "2026-11-11T02:30:00.000Z"),
    ],
    nextCursor: null,
  };
  const quiet = () => new Promise((done) => setTimeout(done, 50));

  it.each([
    ["rejects", () => Promise.reject(new Error("offline"))],
    ["returns the same cursor", () => Promise.resolve(page1)],
  ])(
    "brings back the answer-selected Next and asks no more when it %s",
    async (_, later: () => Promise<MyVotesPage>) => {
      const myVotes = vi.fn((cursor?: string) =>
        cursor ? later() : Promise.resolve(page1),
      );
      show(y.id, myVotes, all, held);
      expect(
        await main().findByRole("button", { name: "Next question" }),
      ).toBeTruthy();
      expect(
        main().queryByRole("button", { name: /Previous question/ }),
      ).toBeNull();
      await act(quiet);
      expect(myVotes.mock.calls).toEqual([[], ["older"]]);
    },
  );

  it("names no wrong neighbour after a failed read, and tries again for another question", async () => {
    let reads = 0;
    const myVotes = vi.fn((cursor?: string) =>
      !cursor
        ? Promise.resolve(page1)
        : ++reads === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(page2),
    );
    show(y.id, myVotes, all, held);
    const user = userEvent.setup();
    await main().findByRole("button", { name: "Next question" });

    // J ends the first page; Y, appended to the rail after the failed read,
    // is not the row below it.
    await user.click(rail().getByRole("link", { name: j.question }));
    await main().findByRole("heading", { name: j.question, level: 1 });
    expect(
      await main().findByRole("button", {
        name: `Next question: ${k.question}`,
      }),
    ).toBeTruthy();
    expect(
      main().queryByRole("button", { name: `Next question: ${y.question}` }),
    ).toBeNull();
    expect(myVotes.mock.calls).toEqual([[], ["older"], ["older"]]);
  });

  it("asks for a later page once while that read is still out", async () => {
    let finish!: (page: MyVotesPage) => void;
    const myVotes = vi.fn((cursor?: string) =>
      cursor
        ? new Promise<MyVotesPage>((resolve) => (finish = resolve))
        : Promise.resolve(page1),
    );
    show(y.id, myVotes, all, held);
    const user = userEvent.setup();
    await waitFor(() => expect(myVotes).toHaveBeenCalledWith("older"));
    await main().findByRole("heading", { name: y.question, level: 1 });

    // First is on the first page: nothing more is wanted there. Back on Y
    // the page is wanted again while the first read is still out.
    await user.click(rail().getByRole("link", { name: first.question }));
    await main().findByRole("button", { name: `Next question: ${j.question}` });
    await user.click(rail().getByRole("link", { name: y.question }));
    await main().findByRole("heading", { name: y.question, level: 1 });
    act(() => finish(page2));
    expect(
      await main().findByRole("button", {
        name: `Previous question: ${k.question}`,
      }),
    ).toBeTruthy();
    expect(myVotes.mock.calls).toEqual([[], ["older"]]);
  });
});
