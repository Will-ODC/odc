// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/types.js";
import { SwipeBallot } from "../src/screens/SwipeBallot.js";
import {
  EMPTY_RESULTS,
  installPointerEvents,
  poll,
  stubApi,
} from "./stub-api.js";

beforeAll(installPointerEvents);
afterEach(cleanup);

const POLL = poll();
const split = () => document.querySelector(".ballot__split") as HTMLElement;

function show(over: Parameters<typeof stubApi>[0] = {}, onAnswered = () => {}) {
  return render(
    <SwipeBallot api={stubApi(over)} poll={POLL} onAnswered={onAnswered} />,
  );
}

describe("asking", () => {
  it("shows the question and both sides", () => {
    show();
    expect(screen.getByText(POLL.question)).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("previews the question each side opens", async () => {
    const linked = poll({ next: ["ads-allowed", "pay-for-it"] });
    render(
      <SwipeBallot
        api={stubApi({
          poll: (id: string) =>
            Promise.resolve(
              poll({
                id,
                question: id === "pay-for-it" ? "How do we pay?" : "Which ads?",
              }),
            ),
        })}
        poll={linked}
        onAnswered={() => {}}
      />,
    );
    expect(await screen.findByText("How do we pay?")).toBeTruthy();
    expect(screen.getByText("Which ads?")).toBeTruthy();
  });

  it("still asks when the previews cannot be loaded", async () => {
    render(
      <SwipeBallot
        api={stubApi({
          poll: () => Promise.reject(new ApiError(404, "gone")),
        })}
        poll={poll({ next: ["ads-allowed", "pay-for-it"] })}
        onAnswered={() => {}}
      />,
    );
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("still walks on when the preview of the next question cannot be loaded", async () => {
    const onAnswered = vi.fn();
    render(
      <SwipeBallot
        api={stubApi({
          // Every preview fetch fails. The edge in the poll is still real.
          poll: () => Promise.reject(new ApiError(404, "gone")),
        })}
        poll={poll({ next: ["ads-allowed", "pay-for-it"] })}
        onAnswered={onAnswered}
      />,
    );

    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    // The way on must survive a failed preview. Gating it on the preview left
    // someone counted, with a run still ahead of them, and nothing to press.
    const on = screen.getByRole("button", { name: /NEXT/ });
    fireEvent.click(on);
    expect(onAnswered).toHaveBeenCalledWith("pay-for-it");
  });

  it("offers no way on when the answer ends the run, preview or not", async () => {
    render(
      <SwipeBallot
        api={stubApi({ poll: () => Promise.reject(new ApiError(404, "gone")) })}
        poll={poll({ next: [null, null] })}
        onAnswered={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    expect(screen.queryByRole("button", { name: /NEXT/ })).toBeNull();
  });
});

describe("casting", () => {
  it("votes for the second choice on the right arrow", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [1]));
    expect(await screen.findByText("Counted.")).toBeTruthy();
  });

  it("votes for the first choice on the left arrow", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    fireEvent.keyDown(screen.getByText("No"), { key: "ArrowLeft" });
    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [0]));
  });

  /**
   * A browser tap is three events, not one: `pointerdown`, `pointerup`, then
   * `click`. Every other test in this file fires one or the other, which is
   * exactly why one press casting two votes survived to be found in review.
   */
  function tap(half: HTMLElement, at = { down: 200, up: 200 }) {
    fireEvent.pointerDown(split(), { clientX: at.down, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: at.up, pointerId: 1 });
    fireEvent.click(half);
  }

  it("casts once for a real tap, not once per event the browser sends", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    tap(screen.getByRole("button", { name: /^Yes -/ }));

    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [1]));
    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("casts once for a drag, and not again for the click that follows it", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    // Held before the drag: committing sets `hidden` on the ballot, and jsdom
    // does apply the user-agent `[hidden]` rule, so the halves drop out of the
    // accessibility tree and cannot be looked up by role afterwards. The click
    // still reaches the element, which is the case being tested.
    const no = screen.getByRole("button", { name: /^No -/ });

    // Past the threshold, leftward, then the click the browser sends anyway.
    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 100, pointerId: 1 });
    fireEvent.click(no);

    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [0]));
    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("does not vote when a drag springs back, click included", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    // Travelled, but not far enough to commit. The click that follows must not
    // turn a cancelled gesture into a vote.
    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 180, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Yes -/ }));

    expect(cast).not.toHaveBeenCalled();
  });

  it("still answers the very next press after a cancelled gesture", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    // The stand-down flag must be consumed, not left set — otherwise it eats
    // the next real vote.
    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 180, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Yes -/ }));

    tap(screen.getByRole("button", { name: /^Yes -/ }));

    await waitFor(() => expect(cast).toHaveBeenCalledTimes(1));
    expect(cast).toHaveBeenCalledWith("ads-free", [1]);
  });

  it("refuses a second vote pressed after the ballot has settled", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    // Held before the vote, for the same reason as above.
    const no = screen.getByRole("button", { name: /^No -/ });

    tap(screen.getByRole("button", { name: /^Yes -/ }));
    await screen.findByText("Counted.");

    // `hidden` keeps this out of a real person's reach; `pick` refusing once
    // settled is what holds it if anything ever presses it anyway. Deleting
    // that check turns this red.
    fireEvent.click(no);

    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("votes for the half that was tapped", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    fireEvent.click(screen.getByRole("button", { name: /^Yes -/ }));
    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [1]));
  });

  it("counts a drag that went far enough, in the direction it went", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 100, pointerId: 1 });

    await waitFor(() => expect(cast).toHaveBeenCalledWith("ads-free", [0]));
  });

  it("does not vote when a drag springs back", () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 180, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 180, pointerId: 1 });

    expect(cast).not.toHaveBeenCalled();
    expect(screen.getByText(POLL.question)).toBeTruthy();
  });

  it("sends one vote however many times the key is pressed", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    const yes = screen.getByText("Yes");
    fireEvent.keyDown(yes, { key: "ArrowRight" });
    fireEvent.keyDown(yes, { key: "ArrowRight" });
    await screen.findByText("Counted.");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });

    expect(cast).toHaveBeenCalledTimes(1);
  });

  it("takes the sides away rather than drawing the outcome over them", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    // Not "is hidden" - gone. The outcome used to be an overlay with no
    // background over a ballot that was still drawn, so both were on screen at
    // once and neither could be read.
    expect(split()).toBeNull();
    expect(screen.queryByText("No")).toBeNull();
  });

  it("keeps the question, because the choice alone does not say what was agreed", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    const question = screen.getByText(POLL.question);
    expect(question).toBeTruthy();
    expect(question.closest("[hidden]")).toBeNull();
  });

  it("names the choice back rather than only ticking it", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Yes");
  });

  it("says a repeat vote replaced the earlier one, which is not a fault", async () => {
    show({
      cast: () =>
        Promise.resolve({
          status: "changed" as const,
          ballot: [1],
          results: EMPTY_RESULTS,
        }),
    });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    expect(
      await screen.findByText("That replaces your earlier answer."),
    ).toBeTruthy();
  });

  it("says so plainly when the poll closed before the swipe landed", async () => {
    show({ cast: () => Promise.resolve({ status: "closed" as const }) });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    expect(await screen.findByText("This one has closed.")).toBeTruthy();
  });

  it("shows the server's own sentence when a vote is refused", async () => {
    show({
      cast: () =>
        Promise.reject(
          new ApiError(400, "A ballot is a list of the choices you picked."),
        ),
    });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    expect(
      await screen.findByText("A ballot is a list of the choices you picked."),
    ).toBeTruthy();
    expect(screen.queryByText("Counted.")).toBeNull();
  });
});

describe("moving on", () => {
  it("opens the poll the chosen side named, when asked to", async () => {
    const onAnswered = vi.fn();
    render(
      <SwipeBallot
        api={stubApi({
          poll: (id: string) =>
            Promise.resolve(poll({ id, question: `about ${id}` })),
        })}
        poll={poll({ next: ["ads-allowed", "pay-for-it"] })}
        onAnswered={onAnswered}
      />,
    );
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });

    const next = await screen.findByRole("button", {
      name: /about pay-for-it/,
    });
    fireEvent.click(next);
    expect(onAnswered).toHaveBeenCalledWith("pay-for-it");
  });

  it("offers no way on when the choice ends the run", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");
    expect(screen.queryByRole("button", { name: /NEXT/ })).toBeNull();
  });
});

describe("the copy", () => {
  it("never raises how anything is counted", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    const shown = (document.body.textContent ?? "").toLowerCase();
    for (const word of [
      "hash",
      "chain",
      "tally",
      "tabulat",
      "ledger",
      "verif",
    ]) {
      expect(shown).not.toContain(word);
    }
  });
});

/**
 * Pulse casts on one press, with no confirming second press - deliberately,
 * against `odc-ui`'s rule, because a run is meant to move at the speed of an
 * opinion. What makes that safe is that an answer is not final, so saying so
 * is not decoration: it is what stands in for the confirmation step.
 */
describe("telling someone the answer is in, and not final", () => {
  const COUNTED = {
    status: "counted" as const,
    ballot: [1],
    results: EMPTY_RESULTS,
  };

  it("says the answer can still be changed", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Counted.");
    expect(done.textContent).toContain(
      "You can change your answer until this question closes.",
    );
  });

  it("says it again when the answer replaced an earlier one", async () => {
    show({
      cast: () =>
        Promise.resolve({
          status: "changed" as const,
          ballot: [1],
          results: EMPTY_RESULTS,
        }),
    });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("That replaces your earlier answer.");
    expect(done.textContent).toContain("You can change your answer");
  });

  it("promises nothing of the sort on a poll that has closed", async () => {
    show({ cast: () => Promise.resolve({ status: "closed" as const }) });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("This one has closed.");
    expect(document.body.textContent).not.toContain("You can change");
  });

  /**
   * The sentence is the whole of what stands in for a confirming press, so it
   * has to be true. It was not: settling took the sides off the screen and
   * nothing put them back, and on the run's first question there is no Back
   * either, so someone told they could change their answer had no route to.
   */
  it("puts the question back when the answer is changed", async () => {
    show();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");
    expect(split()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change my answer" }));

    expect(split()).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.queryByText("Counted.")).toBeNull();
  });

  it("counts the second answer, and says it replaced the first", async () => {
    const cast = vi.fn((_id: string, ballot: number[]) =>
      Promise.resolve({
        status: (cast.mock.calls.length > 1 ? "changed" : "counted") as
          "changed" | "counted",
        ballot,
        results: EMPTY_RESULTS,
      }),
    );
    show({ cast });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");
    fireEvent.click(screen.getByRole("button", { name: "Change my answer" }));
    fireEvent.keyDown(screen.getByText("No"), { key: "ArrowLeft" });

    await screen.findByText("That replaces your earlier answer.");
    expect(cast).toHaveBeenNthCalledWith(2, "ads-free", [0]);
    // The count, not only the arguments: a double-cast on the re-answer path
    // is the regression this whole control is most at risk of.
    expect(cast).toHaveBeenCalledTimes(2);
  });

  /**
   * The arrow keys are read by a handler on the `<section>`, so a keypress only
   * reaches it from a control inside. The control pressed to come back is
   * unmounted by that same render - without somewhere to send focus it lands on
   * the body, and someone who came back by keyboard finds the arrows dead.
   */
  it("puts focus on a side, so the arrow keys still answer", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");
    fireEvent.click(screen.getByRole("button", { name: "Change my answer" }));

    await waitFor(() =>
      expect(document.activeElement?.className).toContain("ballot__half"),
    );

    // The half of the name that matters. Asserting only where focus landed
    // would pass on a build with the section's `onKeyDown` deleted.
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowLeft",
    });
    await waitFor(() => expect(cast).toHaveBeenCalledTimes(2));
  });

  /**
   * A drag that commits answers the press through `gestureDecided`, and the
   * `click` that would consume the flag never arrives - settling unmounts the
   * halves in the same flush. That was harmless while settling was terminal:
   * `key={poll.id}` gave the next question fresh refs. Putting the question
   * back is the one path that returns to a live screen with the old ones, so
   * the flag has to be cleared with the lean.
   *
   * The press this swallowed was a keyboard press on a half - Enter or Space -
   * which is exactly where the focus move now sends someone. A pointer tap
   * clears the flag on `pointerdown` and an arrow key bypasses `pick`, so this
   * is the one combination that breaks, and it is the one the change control
   * leads people into.
   */
  it("answers the first press after the question is put back", async () => {
    const cast = vi.fn(stubApi().cast);
    show({ cast });

    fireEvent.pointerDown(split(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(split(), { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(split(), { clientX: 40, pointerId: 1 });
    await screen.findByText("Counted.");
    expect(cast).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Change my answer" }));
    fireEvent.click(screen.getByRole("button", { name: /Yes/ }));

    await screen.findByText("Counted.");
    expect(cast).toHaveBeenCalledTimes(2);
  });

  /**
   * The closed-cast tests below do NOT cover this: `<Outcome>` returns early on
   * a `closed` cast and never reads `changeable` at all. Without this, both
   * screens could pass `changeable={true}` and the suite would stay green -
   * which is the whole of what ADR-0022 section 3 rests on.
   */
  it("promises nothing on a poll it already knows is shut", async () => {
    render(
      <SwipeBallot
        api={stubApi({ cast: () => Promise.resolve(COUNTED) })}
        poll={poll({ open: false })}
        onAnswered={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("Counted.");

    expect(document.body.textContent).not.toContain("You can change");
    expect(
      screen.queryByRole("button", { name: "Change my answer" }),
    ).toBeNull();
  });

  it("offers no way to change an answer on a poll that has closed", async () => {
    show({ cast: () => Promise.resolve({ status: "closed" as const }) });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("This one has closed.");
    expect(
      screen.queryByRole("button", { name: "Change my answer" }),
    ).toBeNull();
  });

  /**
   * Nothing is promised while the request is still out either - the answer is
   * not in yet, so there is nothing to say can be changed.
   */
  it("waits until the answer is actually in", () => {
    show({ cast: () => new Promise(() => {}) });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    expect(screen.getByText("Sending\u2026")).toBeTruthy();
    expect(document.body.textContent).not.toContain("You can change");
  });
});

describe("seeing where the question stands", () => {
  const COUNTS = {
    status: "counted" as const,
    ballot: [1],
    results: {
      pollId: POLL.id,
      question: POLL.question,
      method: "single" as const,
      voters: 12,
      choices: [
        { index: 0, label: "No", count: 4, share: 33.3 },
        { index: 1, label: "Yes", count: 8, share: 66.7 },
      ],
    },
  };

  function vote(over: Parameters<typeof stubApi>[0] = {}) {
    show({ cast: () => Promise.resolve(COUNTS), ...over });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
  }

  it("offers the numbers only once a vote is in", async () => {
    show({ cast: () => Promise.resolve(COUNTS) });
    // Before answering there is nothing to stand on.
    expect(screen.queryByRole("button", { name: "See results" })).toBeNull();
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    expect(
      await screen.findByRole("button", { name: "See results" }),
    ).toBeTruthy();
  });

  it("shows the counts when asked, in place of the outcome", async () => {
    vote();
    fireEvent.click(await screen.findByRole("button", { name: "See results" }));
    expect(screen.getByText("8 · 66.7%")).toBeTruthy();
    expect(screen.getByText("12 people so far")).toBeTruthy();
    // Replaced, not covered - the same rule the outcome itself follows.
    expect(screen.queryByRole("button", { name: "See results" })).toBeNull();
  });

  it("goes back to the outcome, which still offers the numbers again", async () => {
    vote();
    fireEvent.click(await screen.findByRole("button", { name: "See results" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      await screen.findByRole("button", { name: "See results" }),
    ).toBeTruthy();
  });

  /**
   * Opening the numbers used to take the only way forward off the screen, so a
   * glance cost "Close" and then NEXT. A run moves at the speed of an opinion;
   * making a glance cost two presses to undo teaches people not to glance.
   */
  it("keeps the way on while the numbers are open", async () => {
    const onAnswered = vi.fn();
    render(
      <SwipeBallot
        api={stubApi({ cast: () => Promise.resolve(COUNTS) })}
        poll={poll({ next: ["ads-allowed", "pay-for-it"] })}
        onAnswered={onAnswered}
      />,
    );
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("button", { name: "See results" }));

    const on = screen.getByRole("button", { name: /NEXT/ });
    fireEvent.click(on);
    expect(onAnswered).toHaveBeenCalledWith("pay-for-it");
  });

  it("offers nothing to see when the poll closed before the vote landed", async () => {
    show({ cast: () => Promise.resolve({ status: "closed" as const }) });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByText("This one has closed.");
    expect(screen.queryByRole("button", { name: "See results" })).toBeNull();
  });

  /**
   * The results sit inside the section that reads arrow keys as answers - the
   * same shape that let a keypress on Back cast a vote (8ae4714). Settling
   * already stops the cast, and this is what keeps it stopped.
   */
  it("does not cast when an arrow is pressed with the results open", async () => {
    const cast = vi.fn(() => Promise.resolve(COUNTS));
    show({ cast });
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("button", { name: "See results" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), {
      key: "ArrowLeft",
    });
    expect(cast).toHaveBeenCalledTimes(1);
  });
});

/**
 * Asked for by the operator on 2026-08-25 and satisfied by #131, which moved
 * the outcome inside the chrome so `BallotChrome` renders on both sides of the
 * settled branch. Nothing asserted it, so a later reorganisation of that render
 * could take it away silently. This is that assertion.
 */
describe("the way back, after answering", () => {
  it("keeps Back on the screen once the vote is counted", async () => {
    const onBack = vi.fn();
    render(
      <SwipeBallot
        api={stubApi()}
        poll={POLL}
        onAnswered={() => {}}
        onBack={onBack}
      />,
    );
    fireEvent.keyDown(screen.getByText("Yes"), { key: "ArrowRight" });
    await screen.findByRole("status");
    const back = screen.getByRole("button", { name: /Back/ });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
