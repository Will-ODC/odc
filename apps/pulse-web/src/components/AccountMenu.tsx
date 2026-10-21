import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import "./AccountMenu.css";

/**
 * One small button in the top bar that shows and hides the account's
 * controls: who is signed in and "Sign out", or "Forget my votes here".
 *
 * Three controls side by side wrapped the bar onto two lines on a phone
 * (operator walkthrough, 2026-10-21), so the bar keeps one account control
 * and the rest sit behind it. A disclosure, not an ARIA menu: what it shows
 * is ordinary links and buttons, reached with Tab. Escape closes it and puts
 * focus back on the button.
 */
export function AccountMenu({
  label = "Account",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div className="account-menu" onKeyDown={onKeyDown}>
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
        {open ? children : null}
      </div>
    </div>
  );
}
