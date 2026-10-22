import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import "./AccountMenu.css";

/**
 * One small button in the top bar that shows and hides the account's
 * controls: who is signed in and "Sign out", or "Forget my votes here".
 *
 * Three controls side by side wrapped the bar onto two lines on a phone
 * (operator walkthrough, 2026-10-21), so the bar keeps one account control
 * and the rest sit behind it. A disclosure, not an ARIA menu: what it shows
 * is ordinary links and buttons, reached with Tab. Escape closes it and puts
 * focus back on the button; a press or focus outside it closes it too.
 *
 * The controls stay mounted while hidden: a sign-out sent before the panel
 * closed can still fail, and its question and error must be there when the
 * panel is opened again.
 */
export function AccountMenu({
  label = "Account",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    button.current?.focus();
  }

  // Focus moving to somewhere else on the page closes it. Focus moving to
  // nowhere (a control inside swapping for another) does not.
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && !root.current?.contains(next)) setOpen(false);
  }

  return (
    <div
      ref={root}
      className="account-menu"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={button}
        type="button"
        className="account-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {label}
      </button>
      <div id={panelId} className="account-menu__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
