// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useRoute } from "../src/hooks/use-route.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.history.replaceState(null, "", "/");
});

/*
 * #614: a history event can arrive after the first route commits and before
 * the popstate listener is installed. The probe sends one from its own layout
 * effect, which runs in exactly that gap.
 */
it("follows a popstate that arrives before the listener is installed (#614)", () => {
  globalThis.history.replaceState(null, "", "/about");
  function Probe() {
    const { route } = useRoute();
    const sent = useRef(false);
    useLayoutEffect(() => {
      if (sent.current) return;
      sent.current = true;
      globalThis.history.replaceState(null, "", "/trust");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    return <p>{route.kind}</p>;
  }
  render(<Probe />);
  expect(screen.getByText("trust")).toBeTruthy();
});

it("follows Back and Forward, and stops listening once unmounted", () => {
  globalThis.history.replaceState(null, "", "/about");
  const added = vi.spyOn(globalThis, "addEventListener");
  const removed = vi.spyOn(globalThis, "removeEventListener");
  function Probe() {
    return <p>{useRoute().route.kind}</p>;
  }
  const { unmount } = render(<Probe />);
  act(() => {
    globalThis.history.replaceState(null, "", "/trust");
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText("trust")).toBeTruthy();
  unmount();
  const listeners = (spy: typeof added) =>
    spy.mock.calls.filter(([type]) => type === "popstate").map(([, fn]) => fn);
  expect(listeners(added)).toHaveLength(1);
  expect(listeners(removed)).toEqual(listeners(added));
});

it("pushes and replaces addresses as before", () => {
  globalThis.history.replaceState(null, "", "/about");
  let nav!: ReturnType<typeof useRoute>;
  function Probe() {
    nav = useRoute();
    return <p>{nav.route.kind}</p>;
  }
  render(<Probe />);
  const length = globalThis.history.length;
  act(() => nav.go({ kind: "trust" }));
  expect(globalThis.location.pathname).toBe("/trust");
  expect(globalThis.history.length).toBe(length + 1);
  act(() => nav.replace({ kind: "about" }));
  expect(globalThis.location.pathname).toBe("/about");
  expect(globalThis.history.length).toBe(length + 1);
  expect(screen.getByText("about")).toBeTruthy();
});
