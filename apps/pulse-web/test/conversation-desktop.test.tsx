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
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Ballot, CastOutcome, Poll } from "../src/api/types.js";
import { WIDE } from "../src/hooks/use-wide.js";
import { Conversation } from "../src/screens/Conversation.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

/*
 * The desktop layout (#490): at 700px and wider, voting sits in the page
 * under the question instead of in the bottom-right drawer. jsdom has no
 * `matchMedia`, so every other suite draws the phone layout; this one says
 * the window is wide.
 */
beforeAll(async () => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === WIDE,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  await import("../src/components/BarChart.js");
});
afterAll(() => {
  Reflect.deleteProperty(window, "matchMedia");
});
afterEach(cleanup);

const main = () => within(screen.getByRole("main"));
const said = (text: string) => (_: string, node: Element | null) =>
  node?.tagName === "SPAN" && node.textContent === text;
function tally(p: Poll, ballot: Ballot) {
  return results({
    pollId: p.id,
    question: p.question,
    method: p.method,
    voters: 1,
    choices: p.choices.map((label, index) => ({
      index,
      label,
      count: ballot.includes(index) ? 1 : 0,
      share: ballot.includes(index) ? 100 : 0,
    })),
  });
}
function counting(p: Poll) {
  let attempt = 0;
  return vi.fn(async (_id: string, ballot: Ballot): Promise<CastOutcome> => ({
    status: attempt++ === 0 ? "counted" : "changed",
    ballot,
    results: tally(p, ballot),
  }));
}

it("puts the choices in the page under the question, with no drawer", async () => {
  const p = poll();
  render(<Conversation api={stubApi()} pollId={p.id} />);
  const heading = await main().findByRole("heading", {
    name: p.question,
    level: 1,
  });
  expect(screen.queryByRole("complementary", { name: "Voting" })).toBeNull();
  const voting = main().getByRole("region", { name: p.question });
  expect(
    heading.compareDocumentPosition(voting) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The question prints once: no label, no second heading, nothing to close.
  expect(within(voting).queryByText("DECISION")).toBeNull();
  expect(within(voting).queryByRole("heading")).toBeNull();
  expect(within(voting).queryByRole("button", { name: "Close" })).toBeNull();
  expect(within(voting).getByRole("group", { name: p.question })).toBeTruthy();
  expect(within(voting).getByText("Your answer is private.")).toBeTruthy();
});

it("folds the answer into the You picked line, which takes focus and holds Change my answer", async () => {
  const p = poll();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast: counting(p) })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  const line = (await main().findByText(said("You picked Yes.")))
    .parentElement!;
  await waitFor(() => expect(document.activeElement).toBe(line));
  expect(main().queryByRole("radio")).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Change my answer" }),
  ).toHaveLength(1);
  expect(
    within(line).getByRole("button", { name: "Change my answer" }),
  ).toBeTruthy();
  expect(
    main().getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
});

it("changes an answer in place, keeps the results, and Close sends nothing", async () => {
  const p = poll();
  const cast = counting(p);
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText(said("You picked Yes."));

  await user.click(main().getByRole("button", { name: "Change my answer" }));
  const yes = main().getByRole("radio", { name: "Yes" });
  expect(yes).toHaveProperty("checked", true);
  expect(document.activeElement).toBe(yes);
  // The saved answer's results stay on the page while choosing again.
  expect(
    main().getByRole("group", { name: "How people answered" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change my answer" })).toBeNull();

  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Close" }));
  expect(cast).toHaveBeenCalledTimes(1);
  expect(main().getByText(said("You picked Yes."))).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      main().getByRole("button", { name: "Change my answer" }),
    ),
  );

  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText("Counted. That replaces your earlier answer.");
  expect(cast).toHaveBeenLastCalledWith(p.id, [0]);
  expect(main().getByText(said("You picked No."))).toBeTruthy();
});

it("keeps a closed question's choices on the page with See results under them", async () => {
  const p = poll({ open: false });
  render(<Conversation api={stubApi({ poll: async () => p })} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  expect(screen.queryByRole("complementary", { name: "Voting" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show question" })).toBeNull();
  expect(main().getByRole("group", { name: p.question })).toHaveProperty(
    "disabled",
    true,
  );
  expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
  expect(main().getByRole("button", { name: "See results" })).toBeTruthy();
});

/** Casts that wait until the test settles them, oldest first. */
function heldCasts() {
  const pending: Array<{
    resolve: (outcome: CastOutcome) => void;
    reject: (error: Error) => void;
  }> = [];
  const cast = vi.fn(
    () =>
      new Promise<CastOutcome>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return {
    cast,
    finish: (outcome: CastOutcome) => pending.shift()!.resolve(outcome),
    lose: () => pending.shift()!.reject(new Error("offline")),
  };
}

/** Answers Yes, then opens the choices again and sends No. */
async function changeToNo(
  sends: ReturnType<typeof heldCasts>,
  p: Poll,
  user: ReturnType<typeof userEvent.setup>,
) {
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await act(async () =>
    sends.finish({ status: "counted", ballot: [1], results: tally(p, [1]) }),
  );
  await main().findByText(said("You picked Yes."));
  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
}

it("offers no Close while a changed answer is sent, and focus lands on the new answer", async () => {
  const p = poll();
  const sends = heldCasts();
  const user = userEvent.setup();
  render(<Conversation api={stubApi({ cast: sends.cast })} pollId={p.id} />);
  await changeToNo(sends, p, user);
  expect(main().queryByRole("button", { name: "Close" })).toBeNull();
  await act(async () =>
    sends.finish({ status: "changed", ballot: [0], results: tally(p, [0]) }),
  );
  const line = (await main().findByText(said("You picked No."))).parentElement!;
  await waitFor(() => expect(document.activeElement).toBe(line));
}, 15_000);

it("shows the answer the server holds when Close follows a lost connection", async () => {
  const p = poll();
  const sends = heldCasts();
  let held: Ballot | null = null;
  const myBallot = vi.fn(async () => held);
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({
        cast: sends.cast,
        myBallot,
        results: async () => tally(p, [0]),
      })}
      pollId={p.id}
    />,
  );
  await changeToNo(sends, p, user);
  myBallot.mockClear();
  // Stored, but the reply never arrived.
  held = [0];
  await act(async () => sends.lose());
  await user.click(await main().findByRole("button", { name: "Close" }));
  await main().findByText(said("You picked No."));
  expect(myBallot).toHaveBeenCalledExactlyOnceWith(p.id);
  expect(main().queryByRole("radio")).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      main().getByRole("button", { name: "Change my answer" }),
    ),
  );
  expect(
    screen
      .getByRole("navigation", { name: "My votes" })
      .textContent?.includes("Your answer: No"),
  ).toBe(true);
});

it("shows the earlier answer when Close follows a lost connection that stored nothing", async () => {
  const p = poll();
  const sends = heldCasts();
  const user = userEvent.setup();
  let held: Ballot | null = null;
  render(
    <Conversation
      api={stubApi({
        cast: sends.cast,
        myBallot: async () => held,
        results: async () => tally(p, [1]),
      })}
      pollId={p.id}
    />,
  );
  await changeToNo(sends, p, user);
  held = [1];
  await act(async () => sends.lose());
  await user.click(await main().findByRole("button", { name: "Close" }));
  await main().findByText(said("You picked Yes."));
  expect(main().queryByRole("radio")).toBeNull();
});

it("shows a question whose send is still out after 5 s in the page, without Submit", async () => {
  const first = poll();
  const parks = poll({ id: "parks", question: "More parks?" });
  const sends = heldCasts();
  const api = stubApi({
    poll: graph([first, parks]),
    cast: sends.cast,
    results: async () => tally(first, [1]),
  });
  const user = userEvent.setup();
  const view = render(<Conversation api={api} pollId={first.id} />);
  await main().findByRole("heading", { name: first.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  view.rerender(<Conversation api={api} pollId={parks.id} />);
  await main().findByRole("heading", { name: parks.question, level: 1 });
  vi.useFakeTimers();
  try {
    view.rerender(<Conversation api={api} pollId={first.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(main().getByText("Loading…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const heading = main().getByRole("heading", {
      name: first.question,
      level: 1,
    });
    const pending = main().getByText("Your answer is still being sent.");
    expect(
      heading.compareDocumentPosition(pending) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Voting" })).toBeNull();
    expect(main().queryByRole("radio")).toBeNull();
    expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
    await act(async () =>
      sends.finish({
        status: "counted",
        ballot: [1],
        results: tally(first, [1]),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    main().getByText(said("You picked Yes."));
    expect(main().queryByText("Your answer is still being sent.")).toBeNull();
    expect(sends.cast).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("ignores the server's answer to Close once the answer is sent again", async () => {
  const p = poll();
  const sends = heldCasts();
  let held: Ballot | null = null;
  let answer!: () => void;
  const myBallot = vi.fn(
    () =>
      new Promise<Ballot | null>((resolve) => {
        if (held === null) resolve(null);
        else answer = () => resolve(held);
      }),
  );
  const user = userEvent.setup();
  render(
    <Conversation
      api={stubApi({
        cast: sends.cast,
        myBallot,
        results: async () => tally(p, [1]),
      })}
      pollId={p.id}
    />,
  );
  await changeToNo(sends, p, user);
  held = [1];
  await act(async () => sends.lose());
  await user.click(await main().findByRole("button", { name: "Close" }));
  // Asked once: Close is not offered again while the server is asked.
  expect(main().queryByRole("button", { name: "Close" })).toBeNull();
  expect(myBallot).toHaveBeenCalledTimes(2);
  // Sent again before the server says which answer it holds.
  await user.click(main().getByRole("button", { name: "Try again" }));
  await act(async () => answer());
  // Still sending: the late reply does not put the earlier answer back.
  expect(main().getByRole("button", { name: "Sending…" })).toBeTruthy();
  expect(main().getByRole("radio", { name: "No" })).toHaveProperty(
    "checked",
    true,
  );
  await act(async () =>
    sends.finish({ status: "changed", ballot: [0], results: tally(p, [0]) }),
  );
  await main().findByText(said("You picked No."));
});
