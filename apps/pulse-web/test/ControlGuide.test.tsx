// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlGuide } from "../src/components/ControlGuide.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("leaves token-sized room around results and follows their viewport bounds", () => {
  let bounds = new DOMRect(30, 120, 250, 180);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => bounds,
  );
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
  const spotlight = document.querySelector<HTMLElement>(
    ".control-guide__spotlight",
  )!;
  // Fixed insets leave one spacing token outside the measured content, while
  // max() keeps the border inside the viewport on a narrow phone.
  expect(spotlight.style.top).toBe("max(0px, calc(120px - var(--step)))");
  expect(spotlight.style.left).toBe("max(0px, calc(30px - var(--step)))");
  expect(spotlight.style.right).toBe(
    "max(0px, calc(100vw - 280px - var(--step)))",
  );
  expect(spotlight.style.bottom).toBe(
    "max(0px, calc(100vh - 300px - var(--step)))",
  );

  bounds = new DOMRect(4, 40, 312, 180);
  act(() => document.dispatchEvent(new Event("scroll")));
  expect(spotlight.style.top).toBe("max(0px, calc(40px - var(--step)))");
  expect(spotlight.style.left).toBe("max(0px, calc(4px - var(--step)))");

  bounds = new DOMRect(12, 50, 360, 200);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(spotlight.style.right).toBe(
    "max(0px, calc(100vw - 372px - var(--step)))",
  );
  expect(spotlight.style.bottom).toBe(
    "max(0px, calc(100vh - 250px - var(--step)))",
  );
});
