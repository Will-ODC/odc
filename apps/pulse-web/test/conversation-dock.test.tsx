// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { MyVote, Poll } from "../src/api/types.js";
import { App } from "../src/App.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

beforeAll(() => import("../src/components/BarChart.js"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const newer = poll({ id: "newer", question: "Build the first park?" });
const shut = poll({ id: "shut", question: "Close the old pool?", open: false });
const older = poll({ id: "older", question: "Open the library later?" });

function showClosed() {
  history.replaceState(null, "", "/?poll=shut");
  return render(
    <App
      api={stubApi({
        myVotes: async () => ({
          votes: [
            saved(newer, "2026-11-11T03:00:00.000Z"),
            saved(shut, "2026-11-11T02:00:00.000Z"),
            saved(older, "2026-11-11T01:00:00.000Z"),
          ],
          nextCursor: null,
        }),
        poll: graph([newer, shut, older]),
        myBallot: async () => [1],
        results: async (id) => results({ pollId: id }),
      })}
    />,
  );
}

const main = () => within(screen.getByRole("main"));

it("gives the page as much bottom space as the open Voting drawer is tall, as it changes (#528)", async () => {
  let height = 377;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        height: this.classList.contains("conversation__dock") ? height : 0,
      } as DOMRect;
    },
  );
  const watchers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly fit: () => void) {}
      observe() {
        watchers.push(this.fit);
      }
      disconnect() {
        watchers.splice(watchers.indexOf(this.fit), 1);
      }
    },
  );
  const { container } = showClosed();
  await main().findByRole("heading", { name: shut.question, level: 1 });
  await screen.findByRole("complementary", { name: "Voting" });
  const scroll = container.querySelector<HTMLElement>(".conversation__scroll")!;
  expect(scroll.style.getPropertyValue("--dock-space")).toBe("377px");

  // The drawer closes to its handle: the space follows.
  height = 48;
  act(() => watchers.forEach((fit) => fit()));
  expect(scroll.style.getPropertyValue("--dock-space")).toBe("48px");
});

it("puts a closed saved question's See results and its Previous and Next on one row (#528)", async () => {
  showClosed();
  await main().findByRole("heading", { name: shut.question, level: 1 });
  const next = await main().findByRole("button", {
    name: `Next question: ${older.question}`,
  });
  const row = next.closest(".conversation__closed");
  expect(row).not.toBeNull();
  expect(
    within(row as HTMLElement).getByRole("button", { name: "See results" }),
  ).toBeTruthy();
});
