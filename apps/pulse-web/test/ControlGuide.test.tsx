// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlGuide } from "../src/components/ControlGuide.js";

// The layout viewport without scrollbars; deliberately not jsdom's 1024x768
// window.innerWidth/innerHeight, so viewport units would give other numbers.
const CLIENT_W = 375;
const CLIENT_H = 640;
let bounds = new DOMRect(30, 120, 250, 180);

beforeEach(() => {
  document.documentElement.style.setProperty("--step", "8px");
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
    CLIENT_W,
  );
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
    CLIENT_H,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => bounds,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--step");
});

function spotlight() {
  bounds = new DOMRect(30, 120, 250, 180);
  const root = createRef<HTMLDivElement>();
  render(
    <div ref={root}>
      <section className="results">How people answered</section>
    </div>,
  );
  render(
    <ControlGuide
      root={root}
      selector=".results"
      text="Read results."
      finished
      onDismiss={() => {}}
    />,
  );
  const el = document.querySelector<HTMLElement>(".control-guide__spotlight")!;
  return () => ({
    top: el.style.top,
    left: el.style.left,
    width: el.style.width,
    height: el.style.height,
  });
}

it("leaves one --step of room on every side of the control", () => {
  const box = spotlight();
  expect(box()).toEqual({
    top: "112px",
    left: "22px",
    width: "266px",
    height: "196px",
  });
});

it("clamps the left and top edges to the screen on scroll", () => {
  const box = spotlight();
  bounds = new DOMRect(4, 3, 200, 100);
  act(() => document.dispatchEvent(new Event("scroll")));
  // Only 4px and 3px of room exist before the edge; the far sides keep 8px.
  expect(box()).toEqual({
    top: "0px",
    left: "0px",
    width: "212px",
    height: "111px",
  });
});

it("clamps the right and bottom edges to clientWidth/clientHeight on resize", () => {
  const box = spotlight();
  bounds = new DOMRect(20, 500, CLIENT_W - 24, CLIENT_H - 500 - 2);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(box()).toEqual({
    top: "492px",
    left: "12px",
    width: `${CLIENT_W - 12}px`,
    height: `${CLIENT_H - 492}px`,
  });
});

it("keeps a control scrolled fully off-screen as an empty box on the edge", () => {
  const box = spotlight();
  bounds = new DOMRect(40, CLIENT_H + 60, 200, 100);
  act(() => document.dispatchEvent(new Event("scroll")));
  // Nothing is drawn outside the screen and no size goes negative.
  expect(box()).toEqual({
    top: `${CLIENT_H}px`,
    left: "32px",
    width: "216px",
    height: "0px",
  });
});
