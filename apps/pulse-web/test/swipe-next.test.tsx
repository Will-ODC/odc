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
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { graph, poll, stubApi } from "./stub-api.js";

// jsdom 26 has no PointerEvent; see use-swipe.test.tsx.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.isPrimary = init.isPrimary ?? false;
  }
}
beforeAll(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
beforeAll(() => import("../src/components/BarChart.js"));
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const main = () => within(screen.getByRole("main"));
function swipeLeft(over: HTMLElement, dx = -120) {
  const at = { pointerId: 1, pointerType: "touch", isPrimary: true };
  fireEvent.pointerDown(over, { ...at, clientX: 300, clientY: 400 });
  fireEvent.pointerUp(over, { ...at, clientX: 300 + dx, clientY: 410 });
}

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
  // Not answered yet: nothing to move on to, and the page takes no swipes.
  expect(heading.closest(".conversation__question--swipe")).toBeNull();
  swipeLeft(heading);
  expect(location.search).toBe("?poll=ads-free");

  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await main().findByRole("button", { name: "Next question" });
  const answered = main().getByRole("heading", {
    name: first.question,
    level: 1,
  });
  const area = answered.closest<HTMLElement>(".conversation__question--swipe");
  expect(area).not.toBeNull();
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
