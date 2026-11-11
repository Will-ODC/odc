// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLeftSwipe, useSwipeLeft } from "../src/hooks/use-swipe.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Area({ onSwipeLeft }: { onSwipeLeft?: () => void }) {
  return (
    <div data-testid="area" {...useSwipeLeft(onSwipeLeft)}>
      Question
    </div>
  );
}

const finger = (identifier: number, clientX: number, clientY: number) => ({
  identifier,
  clientX,
  clientY,
});

/** One finger: down at (200, 300), up after moving (dx, dy). */
function drag(dx: number, dy: number, { cancel = false } = {}) {
  const area = screen.getByTestId("area");
  const down = finger(1, 200, 300);
  const up = finger(1, 200 + dx, 300 + dy);
  fireEvent.touchStart(area, { touches: [down], changedTouches: [down] });
  fireEvent.touchMove(area, { touches: [up], changedTouches: [up] });
  if (cancel)
    fireEvent.touchCancel(area, { touches: [], changedTouches: [up] });
  fireEvent.touchEnd(area, { touches: [], changedTouches: [up] });
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
  it("calls back on a one-finger left swipe of 60px or more", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-60, 4);
    expect(swiped).toHaveBeenCalledOnce();
    drag(-120, -10);
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
    const area = screen.getByTestId("area");
    fireEvent.pointerDown(area, { clientX: 200, clientY: 300 });
    fireEvent.mouseDown(area, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(area, { clientX: 0, clientY: 300 });
    fireEvent.mouseUp(area, { clientX: 0, clientY: 300 });
    expect(swiped).not.toHaveBeenCalled();
  });
  it("drops a gesture the browser cancelled", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    drag(-200, 0, { cancel: true });
    expect(swiped).not.toHaveBeenCalled();
  });
  it("ignores a pinch: two fingers at the start or joining midway", () => {
    const swiped = vi.fn();
    render(<Area onSwipeLeft={swiped} />);
    const area = screen.getByTestId("area");
    const a = finger(1, 200, 300);
    const b = finger(2, 260, 300);
    const aLeft = finger(1, 0, 300);
    fireEvent.touchStart(area, { touches: [a, b], changedTouches: [a, b] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [aLeft, b] });
    fireEvent.touchStart(area, { touches: [a], changedTouches: [a] });
    fireEvent.touchMove(area, { touches: [aLeft, b], changedTouches: [b] });
    fireEvent.touchEnd(area, { touches: [b], changedTouches: [aLeft] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [b] });
    expect(swiped).not.toHaveBeenCalled();
  });
  it("leaves sideways drags to panning while the page is zoomed in", () => {
    const swiped = vi.fn();
    vi.stubGlobal("visualViewport", { scale: 2 });
    render(<Area onSwipeLeft={swiped} />);
    drag(-200, 0);
    expect(swiped).not.toHaveBeenCalled();
    vi.stubGlobal("visualViewport", { scale: 1 });
    drag(-200, 0);
    expect(swiped).toHaveBeenCalledOnce();
  });
  it("listens to nothing without a callback", () => {
    render(<Area />);
    expect(() => drag(-200, 0)).not.toThrow();
  });
});
