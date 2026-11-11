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
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { UNREACHABLE } from "../src/api/types.js";
import type { Ballot, CastOutcome, Poll } from "../src/api/types.js";
import { WIDE } from "../src/hooks/use-wide.js";
import { Conversation } from "../src/screens/Conversation.js";
import { pulseServer, tally } from "./pulse-server.js";
import { graph, poll, stubApi } from "./stub-api.js";

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

it("asks the server on Close after the real client loses the connection (#527)", async () => {
  const p = poll();
  const server = pulseServer(p);
  const user = userEvent.setup();
  render(<Conversation api={server.api} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText(said("You picked Yes."));
  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  server.dropNextSend();
  server.asked.length = 0;
  await user.click(main().getByRole("button", { name: "Submit" }));
  // One sentence for a lost connection, wherever it is caught.
  await main().findByText(
    "Couldn't reach pulse. Check your connection and try again.",
  );
  await user.click(await main().findByRole("button", { name: "Close" }));
  // The send was stored: Close asks, and shows No rather than the old Yes.
  await main().findByText(said("You picked No."));
  expect(server.asked).toContain(`GET /api/polls/${p.id}/ballot`);
  expect(main().queryByRole("radio")).toBeNull();
}, 15_000);

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

it("keeps Close in place while it asks the server, says so, and holds Try again (#527)", async () => {
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
        results: async () => tally(p, [0]),
      })}
      pollId={p.id}
    />,
  );
  await changeToNo(sends, p, user);
  // The lost send was stored.
  held = [0];
  await act(async () => sends.lose());
  const close = await main().findByRole("button", { name: "Close" });
  await user.click(close);
  // Close stays, marked, and keeps focus; the old problem gives way to a
  // status line, and Try again waits for the answer.
  expect(close.isConnected).toBe(true);
  expect(close.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(close);
  expect(main().getByText("Checking your answer…").getAttribute("role")).toBe(
    "status",
  );
  expect(main().queryByRole("alert")).toBeNull();
  expect(
    main().getByRole("button", { name: "Try again" }).hasAttribute("disabled"),
  ).toBe(true);
  // A second Close while asking does not ask again.
  await user.click(close);
  expect(myBallot).toHaveBeenCalledTimes(2);
  await act(async () => answer());
  await main().findByText(said("You picked No."));
  expect(main().queryByText("Checking your answer…")).toBeNull();
  expect(main().queryByRole("radio")).toBeNull();
});

it("keeps saved questions beside results and puts the new answer first", async () => {
  const p = poll();
  const user = userEvent.setup();
  const myVotes = vi.fn(async () => ({
    votes: [
      {
        pollId: "parks",
        question: "More parks?",
        choices: ["No"],
        ballot: [0],
        castAt: "2026-11-09T12:00:00.000Z",
        closesAt: null,
        open: true,
      },
    ],
    nextCursor: null,
  }));
  render(
    <Conversation
      api={stubApi({ myVotes, cast: counting(p) })}
      pollId={p.id}
    />,
  );
  const rail = within(screen.getByRole("navigation", { name: "My votes" }));
  await rail.findByRole("link", { name: "More parks?" });
  await main().findByRole("radio", { name: "Yes" });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByRole("group", { name: "How people answered" });
  const links = within(rail.getByRole("list")).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    p.question,
    "More parks?",
  ]);
  expect(links[0]?.getAttribute("aria-current")).toBe("page");
  expect(rail.getByText("Your answer: Yes")).toBeTruthy();
  expect(myVotes).toHaveBeenCalledTimes(1);
});

it("says the connection is still down, and focuses Close, when the server cannot be asked either (#527)", async () => {
  const p = poll();
  const server = pulseServer(p);
  const user = userEvent.setup();
  render(<Conversation api={server.api} pollId={p.id} />);
  await main().findByRole("heading", { name: p.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByText(said("You picked Yes."));
  await user.click(main().getByRole("button", { name: "Change my answer" }));
  await user.click(main().getByRole("radio", { name: "No" }));
  server.dropNextSend();
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByRole("alert");
  server.setOffline(true);
  await user.click(main().getByRole("button", { name: "Close" }));
  // Shown again in a fresh alert, so it is announced again.
  const alert = await main().findByRole("alert");
  expect(alert.textContent).toBe(UNREACHABLE);
  const close = main().getByRole("button", { name: "Close" });
  expect(close.getAttribute("aria-disabled")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(close));
  expect(
    main().getByRole("button", { name: "Try again" }).hasAttribute("disabled"),
  ).toBe(false);
  expect(main().getByRole("radio", { name: "No" })).toHaveProperty(
    "checked",
    true,
  );
  // Back online, Close asks again and finds the stored answer.
  server.setOffline(false);
  await user.click(close);
  await main().findByText(said("You picked No."));
}, 15_000);

it("gives up on a read that never finishes, and ignores its late answer once the answer sent again is counted (#519)", async () => {
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
  // The lost send stored nothing: asked now, the server would say Yes.
  held = [1];
  await act(async () => sends.lose());
  vi.useFakeTimers();
  try {
    // Clicked directly: user-event's own waits would run on the fake clock.
    fireEvent.click(main().getByRole("button", { name: "Close" }));
    expect(myBallot).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(main().getByRole("alert").textContent).toBe(UNREACHABLE);
    // Sent again, and counted, before the server's answer to Close arrives.
    fireEvent.click(main().getByRole("button", { name: "Try again" }));
    await act(async () =>
      sends.finish({ status: "changed", ballot: [0], results: tally(p, [0]) }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    main().getByText(said("You picked No."));
    await act(async () => answer());
  } finally {
    vi.useRealTimers();
  }
  // The late reply describes the server before the retry: it changes nothing.
  expect(main().getByText(said("You picked No."))).toBeTruthy();
  expect(main().queryByText(said("You picked Yes."))).toBeNull();
  const rail = screen.getByRole("navigation", { name: "My votes" });
  expect(rail.textContent?.includes("Your answer: No")).toBe(true);
  expect(rail.textContent?.includes("Your answer: Yes")).toBe(false);
});
