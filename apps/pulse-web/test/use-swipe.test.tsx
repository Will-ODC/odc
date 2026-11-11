// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { isLeftSwipe, useSwipeLeft } from "../src/hooks/use-swipe.js";

// jsdom 26 has no PointerEvent, so fireEvent would drop pointerType and
// pointerId. A MouseEvent carrying them is all the hook reads.
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
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

function Area({ onSwipeLeft }: { onSwipeLeft?: () => void }) {
  return (
    <div data-testid="area" {...useSwipeLeft(onSwipeLeft)}>
      Question
    </div>
  );
}

/** One gesture: down at (200, 300), up after moving (dx, dy). */
function drag(
  dx: number,
  dy: number,
  pointerType = "touch",
  { cancel = false, pointerId = 1 } = {},
) {
  const area = screen.getByTestId("area");
  fireEvent.pointerDown(area, {
    pointerId: 1,
    pointerType,
    isPrimary: true,
    clientX: 200,
    clientY: 300,
  });
  if (cancel) fireEvent.pointerCancel(area, { pointerId: 1, pointerType });
  fireEvent.pointerUp(area, {
    pointerId,
    pointerType,
    isPrimary: true,
    clientX: 200 + dx,
    clientY: 300 + dy,
  });
}

describe("isLeftSwipe", () => {
  it("needs at least 60px to the left", () => {
    expect(isLeftSwipe(-60, 0)).toBe(true);
    expect(isLeftSwipe(-59, 0)).toBe(false);
    expect(isLeftSwipe(60, 0)).toBe(false);
  });
  it("needs the sideways travel to clearly beat the vertical", () => {
    expect(isLeftSwipe(-90, 59)).toBe(true);
    expect(isLeftSwipe(-90, -60)).toBe(false);
    expect(isLeftSwipe(-80, 80)).toBe(false);
    expect(isLeftSwipe(0, -200)).toBe(false);
  });
});

describe("useSwipeLeft", () => {
  it("calls back on a left touch or pen swipe of 60px or more", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-60, 4);
    expect(swiped).toHaveBeenCalledOnce();
    drag(-120, -10, "pen");
    expect(swiped).toHaveBeenCalledTimes(2);
  });
  it("ignores short, vertical, diagonal and rightward drags", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-40, 0);
    drag(-10, -200);
    drag(-80, 70);
    drag(120, 0);
    expect(swiped).not.toHaveBeenCalled();
  });
  it("never treats a mouse drag as a swipe", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-200, 0, "mouse");
    expect(swiped).not.toHaveBeenCalled();
  });
  it("drops a gesture the browser took over, or another pointer's lift", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-200, 0, "touch", { cancel: true });
    drag(-200, 0, "touch", { pointerId: 2 });
    expect(swiped).not.toHaveBeenCalled();
  });
  it("listens to nothing without a callback", () => {
    render(<Area />);
    expect(() => drag(-200, 0)).not.toThrow();
  });
});
