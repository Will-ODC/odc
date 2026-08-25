// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Results } from "../src/api/types.js";
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
          results: EMPTY_RESULTS as Results,
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
