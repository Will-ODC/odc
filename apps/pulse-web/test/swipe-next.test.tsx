// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it } from "vitest";
import { App } from "../src/App.js";
import { graph, poll, stubApi } from "./stub-api.js";

beforeAll(() => import("../src/components/BarChart.js"));
afterEach(cleanup);

const main = () => within(screen.getByRole("main"));
function swipeLeft(over: HTMLElement, dx = -120) {
  const down = { identifier: 1, clientX: 300, clientY: 400 };
  const up = { identifier: 1, clientX: 300 + dx, clientY: 410 };
  fireEvent.touchStart(over, { touches: [down], changedTouches: [down] });
  fireEvent.touchMove(over, { touches: [up], changedTouches: [up] });
  fireEvent.touchEnd(over, { touches: [], changedTouches: [up] });
}

it("draws Loading… outside the question wrapper, so only a loaded question slides in (#554)", async () => {
  history.replaceState(null, "", "/?poll=ads-free");
  render(<App api={stubApi({ poll: () => new Promise<never>(() => {}) })} />);
  const loading = await main().findByText("Loading…");
  expect(loading.closest(".conversation__scroll")).not.toBeNull();
  expect(loading.closest(".conversation__question")).toBeNull();
});

it("a left swipe over an answered question opens the next one, like Next question (#554)", async () => {
  const first = poll({ next: [null, "parks"] });
  const parks = poll({ id: "parks", question: "More parks?" });
  history.replaceState(null, "", "/?poll=ads-free");
  render(<App api={stubApi({ poll: graph([first, parks]) })} />);
  const user = userEvent.setup();
  const heading = await main().findByRole("heading", {
    name: first.question,
    level: 1,
  });
  // Not answered yet: there is nothing to move on to.
  swipeLeft(heading);
  expect(location.search).toBe("?poll=ads-free");

  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByRole("button", { name: "Next question" });
  const answered = main().getByRole("heading", {
    name: first.question,
    level: 1,
  });
  // A short drag is not a swipe.
  swipeLeft(answered, -30);
  expect(location.search).toBe("?poll=ads-free");

  swipeLeft(answered);
  const next = await main().findByRole("heading", {
    name: parks.question,
    level: 1,
  });
  expect(location.search).toBe("?poll=parks");
  // Focus lands where Next question puts it: the new question's heading.
  await waitFor(() => expect(document.activeElement).toBe(next));
});
