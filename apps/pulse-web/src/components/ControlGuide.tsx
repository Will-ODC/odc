import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import "./ControlGuide.css";

type Box = { top: number; left: number; width: number; height: number };

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

/**
 * The spotlight is position: fixed, so its box is the layout viewport without
 * scrollbars: documentElement.clientWidth/clientHeight, not 100vw/100vh.
 * Pad by one --step, then clamp each edge into that box, so padding becomes
 * asymmetric where the control touches the screen edge.
 */
export function spotlightBox(rect: DOMRect, pad: number): Box {
  const { clientWidth, clientHeight } = document.documentElement;
  const left = clamp(rect.left - pad, clientWidth);
  const top = clamp(rect.top - pad, clientHeight);
  const right = clamp(rect.right + pad, clientWidth);
  const bottom = clamp(rect.bottom + pad, clientHeight);
  return { top, left, width: right - left, height: bottom - top };
}

/** Nonmodal help: the highlighted controls retain their ordinary behavior. */
export function ControlGuide({
  root,
  selector,
  text,
  finished,
  onDismiss,
}: {
  root: RefObject<HTMLDivElement | null>;
  selector: string;
  text: string;
  finished: boolean;
  onDismiss: () => void;
}) {
  const id = useId();
  const started = useRef(false);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(selector);
    if (!target) {
      setBox(null);
      return;
    }
    target.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    const measure = () => {
      const pad =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--step"),
        ) || 0;
      setBox(spotlightBox(target.getBoundingClientRect(), pad));
    };
    measure();
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resize?.observe(target);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    const before = target.getAttribute("aria-describedby");
    target.setAttribute(
      "aria-describedby",
      [before, id].filter(Boolean).join(" "),
    );
    // Attach the explanation before focus, so the first instruction is announced.
    if (!started.current) {
      started.current = true;
      (
        target.querySelector<HTMLElement>("input:checked") ??
        target.querySelector<HTMLElement>("input") ??
        target
      ).focus({ preventScroll: true });
    }
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
      if (before === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", before);
    };
  }, [root, selector, id, text]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onDismiss]);
  return createPortal(
    <>
      {box ? (
        <div
          className="control-guide__spotlight"
          aria-hidden="true"
          // Expand the overlay, not the controls, and keep every edge visible.
          style={{
            top: `${box.top}px`,
            left: `${box.left}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        />
      ) : null}
      <aside className="control-guide" aria-label="Voting help">
        <p id={id} role="status">
          {text}
        </p>
        <button type="button" onClick={onDismiss}>
          {finished ? "Done with help" : "Skip help"}
        </button>
      </aside>
    </>,
    document.body,
  );
}
