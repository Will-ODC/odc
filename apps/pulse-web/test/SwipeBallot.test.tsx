// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Ballot,
  CastOutcome,
  Poll,
  PulseApi,
  Results,
} from "../src/api/types.js";
import { ApiError } from "../src/api/types.js";
import { SwipeBallot } from "../src/screens/SwipeBallot.js";

afterEach(cleanup);

/**
 * jsdom has no `PointerEvent`, and without one testing-library falls back to a
 * plain `Event` that carries no coordinates — every drag would arrive as a drag
 * of zero pixels and the gesture tests would pass without testing the gesture.
 * `MouseEvent` already carries clientX, so it is the whole of what is needed.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;

const POLL: Poll = {
  id: "p1",
  question: "Should the ODC stay free of paid ads?",
  choices: ["No", "Yes"],
  method: "single",
  closesAt: null,
  open: true,
};

/**
 * A plain object is enough: `PulseApi` is structural, so a stub does not have
 * to extend anything. Only the two methods this screen calls do any work; the
 * rest exist to satisfy the interface and reject loudly if the screen ever
 * starts calling them without a test saying so.
 */
function stubApi(over: Partial<PulseApi> = {}): PulseApi {
  const unused = (name: string) => () =>
    Promise.reject(new Error(`the ballot should not call ${name}`));
  return {
    poll: () => Promise.resolve(POLL),
    cast: () =>
      Promise.resolve({
        status: "counted",
        ballot: [1] as Ballot,
        results: {} as Results,
      } satisfies CastOutcome),
    requestLink: unused("requestLink"),
    redeem: unused("redeem"),
    me: unused("me"),
    signOut: unused("signOut"),
    myBallot: unused("myBallot"),
    results: unused("results"),
    ...over,
  } as PulseApi;
}

const ballot = () => document.querySelector(".ballot__split") as HTMLElement;

describe("the four states", () => {
  it("says it is loading before the ballot arrives", () => {
    render(
      <SwipeBallot
        api={stubApi({ poll: () => new Promise(() => {}) })}
        pollId="p1"
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the question and both sides once it arrives", async () => {
    render(<SwipeBallot api={stubApi()} pollId="p1" />);
    expect(await screen.findByText(POLL.question)).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("says there is nothing to vote on when the poll is not there", async () => {
    const api = stubApi({
      poll: () =>
        Promise.reject(new ApiError(404, "no such poll", "unknown_poll")),
    });
    render(<SwipeBallot api={api} pollId="p1" />);
    expect(
      await screen.findByText("There is nothing to vote on yet."),
    ).toBeTruthy();
  });

  it("shows one plain sentence when the ballot cannot be reached", async () => {
    const api = stubApi({
      poll: () => Promise.reject(new TypeError("offline")),
    });
    render(<SwipeBallot api={api} pollId="p1" />);
    expect(
      await screen.findByText(
        "We could not reach the ballot. Check your connection and try again.",
      ),
    ).toBeTruthy();
  });

  it("refuses a poll that a swipe cannot answer, rather than rendering half of it", async () => {
    const api = stubApi({
      poll: () => Promise.resolve({ ...POLL, choices: ["No", "Yes", "Later"] }),
    });
    render(<SwipeBallot api={api} pollId="p1" />);
    expect(
      await screen.findByText("This question takes more than a yes or a no."),
    ).toBeTruthy();
    expect(screen.queryByText("Later")).toBeNull();
  });
});

describe("casting", () => {
  it("votes for the second choice on the right arrow", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [1]));
    expect(await screen.findByText(/Counted\./)).toBeTruthy();
  });

  it("votes for the first choice on the left arrow", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    fireEvent.keyDown(screen.getByText("No"), { key: "ArrowLeft" });

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [0]));
  });

  /**
   * A browser tap is three events, not one: `pointerdown`, `pointerup`, then
   * `click`. Every other test in this file fires one or the other, which is
   * exactly why one press casting two votes survived to be found in review.
   */
  function tap(half: HTMLElement, at = { down: 200, up: 200 }) {
    fireEvent.pointerDown(ballot(), { clientX: at.down, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: at.up, pointerId: 1 });
    fireEvent.click(half);
  }

  it("casts once for a real tap, not once per event the browser sends", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    tap(screen.getByRole("button", { name: /^Yes —/ }));

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [1]));
    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("casts once for a drag, and not again for the click that follows it", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    // Held before the drag: committing sets `hidden` on the ballot, and jsdom
    // does apply the user-agent `[hidden]` rule, so the halves drop out of the
    // accessibility tree and cannot be looked up by role afterwards. The click
    // still reaches the element, which is the case being tested.
    const no = screen.getByRole("button", { name: /^No —/ });

    // Past the threshold, leftward, then the click the browser sends anyway.
    fireEvent.pointerDown(ballot(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(ballot(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: 100, pointerId: 1 });
    fireEvent.click(no);

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [0]));
    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("does not vote when a drag springs back, click included", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    // Travelled, but not far enough to commit. The click that follows must not
    // turn a cancelled gesture into a vote.
    fireEvent.pointerDown(ballot(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(ballot(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: 180, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Yes —/ }));

    expect(cast).not.toHaveBeenCalled();
  });

  it("still answers the very next press after a cancelled gesture", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    // The stand-down flag must be consumed, not left set — otherwise it eats
    // the next real vote.
    fireEvent.pointerDown(ballot(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(ballot(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: 180, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Yes —/ }));

    tap(screen.getByRole("button", { name: /^Yes —/ }));

    await waitFor(() => expect(cast).toHaveBeenCalledTimes(1));
    expect(cast).toHaveBeenCalledWith("p1", [1]);
  });

  it("refuses a second vote pressed after the ballot has settled", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    // Held before the vote, for the same reason as above.
    const no = screen.getByRole("button", { name: /^No —/ });

    tap(screen.getByRole("button", { name: /^Yes —/ }));
    await screen.findByText("Counted.");

    // `hidden` keeps this out of a real person's reach; `pick` refusing once
    // settled is what holds it if anything ever presses it anyway. Deleting
    // that check turns this red.
    fireEvent.click(no);

    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("votes for the half that was tapped", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    fireEvent.click(screen.getByRole("button", { name: /^Yes —/ }));

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [1]));
  });

  it("counts a drag that went far enough, in the direction it went", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    fireEvent.pointerDown(ballot(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(ballot(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: 100, pointerId: 1 });

    await waitFor(() => expect(cast).toHaveBeenCalledWith("p1", [0]));
  });

  it("does not vote when a drag springs back", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    fireEvent.pointerDown(ballot(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(ballot(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(ballot(), { clientX: 180, pointerId: 1 });

    expect(cast).not.toHaveBeenCalled();
    expect(screen.getByText(POLL.question)).toBeTruthy();
  });

  it("sends one vote however many times the key is pressed", async () => {
    const cast = vi.fn(stubApi().cast);
    render(<SwipeBallot api={stubApi({ cast })} pollId="p1" />);
    await screen.findByText(POLL.question);

    const yes = screen.getByText("Yes");
    fireEvent.keyDown(yes, { key: "ArrowRight" });
    fireEvent.keyDown(yes, { key: "ArrowRight" });
    await screen.findByText(/Counted\./);
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });

    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("names the choice back rather than only ticking it", async () => {
    render(<SwipeBallot api={stubApi()} pollId="p1" />);
    await screen.findByText(POLL.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Yes");
  });

  it("says a repeat vote replaced the earlier one, which is not a fault", async () => {
    const api = stubApi({
      cast: () =>
        Promise.resolve({
          status: "changed",
          ballot: [1],
          results: {} as Results,
        } satisfies CastOutcome),
    });
    render(<SwipeBallot api={api} pollId="p1" />);
    await screen.findByText(POLL.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    expect(
      await screen.findByText(/replaces your earlier answer/),
    ).toBeTruthy();
  });

  it("says so plainly when the poll closed before the swipe landed", async () => {
    const api = stubApi({ cast: () => Promise.resolve({ status: "closed" }) });
    render(<SwipeBallot api={api} pollId="p1" />);
    await screen.findByText(POLL.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    expect(await screen.findByText("This one has closed.")).toBeTruthy();
  });

  it("does not claim a vote was counted when the server refused it", async () => {
    const api = stubApi({
      cast: () =>
        Promise.reject(new ApiError(401, "sign in first", "unauthorized")),
    });
    render(<SwipeBallot api={api} pollId="p1" />);
    await screen.findByText(POLL.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    expect(
      await screen.findByText(
        "We could not count that yet — this ballot needs you signed in first.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Counted\./)).toBeNull();
  });
});

describe("the copy", () => {
  it("never raises how anything is counted", async () => {
    render(<SwipeBallot api={stubApi()} pollId="p1" />);
    await screen.findByText(POLL.question);
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText(/Counted\./);

    const shown = document.body.textContent ?? "";
    for (const word of [
      "hash",
      "chain",
      "tally",
      "tabulat",
      "ledger",
      "verif",
    ]) {
      expect(shown.toLowerCase()).not.toContain(word);
    }
  });
});
