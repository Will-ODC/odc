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
import { afterEach, beforeAll, expect, it, vi } from "vitest";
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
  await user.click(
    await main().findByRole("button", {
      name: `Next question: ${third.question}`,
    }),
  );
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
