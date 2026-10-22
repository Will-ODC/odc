import type { ReactNode } from "react";
import "./AppShell.css";

/** Shared page frame: consistent banner, centered content and optional desktop rails. */
export function AppShell({
  banner,
  nav,
  aside,
  children,
}: {
  /** The shared site navigation, visible at every width. */
  banner?: ReactNode;
  /** The left rail. Omitted on a screen with nowhere to navigate. */
  nav?: ReactNode;
  /** The right rail. Omitted on a screen with nothing to put beside it. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      {banner ? <header className="shell__banner">{banner}</header> : null}
      <div className="shell__body">
        {/*
         * `aria-hidden` is deliberately NOT set on these: the rails carry real
         * navigation and real content, and hiding them from a screen reader
         * while showing them to everyone else is the accessibility bug this
         * layout would otherwise introduce. They are hidden by CSS at narrow
         * widths, which removes them from the tree for everyone equally.
         */}
        {nav ? (
          <div className="shell__rail shell__rail--start">{nav}</div>
        ) : null}
        <main className="shell__stage">{children}</main>
        {aside ? (
          <div className="shell__rail shell__rail--end">{aside}</div>
        ) : null}
      </div>
    </div>
  );
}
