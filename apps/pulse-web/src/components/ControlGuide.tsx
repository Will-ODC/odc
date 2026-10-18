import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import "./ControlGuide.css";

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
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(selector);
    if (!target) {
      setRect(null);
      return;
    }
    target.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    const measure = () => setRect(target.getBoundingClientRect());
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
      {rect ? (
        <div
          className="control-guide__spotlight"
          aria-hidden="true"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
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
