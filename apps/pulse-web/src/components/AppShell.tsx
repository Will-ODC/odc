import type { ReactNode } from "react";
import "./AppShell.css";

/**
 * The room the phone sits in.
 *
 * Pulse is a phone screen by design, and on a laptop that left a 390px column
 * marooned in the middle of a dark page the same colour as itself: the whole
 * window read as the app, but only the strip in the middle answered a press.
 * Everything else looked live and was not.
 *
 * So the width is given something to hold rather than being taken away from
 * the screen. The stage keeps the phone exactly as it is — the ballots are
 * merged, tested and unchanged by this — and the rails stand either side of
 * it as furniture that is plainly furniture.
 *
 * Purely presentational, and both rails are optional: what goes in them is a
 * screen's business, because only a screen knows what it is showing. Below
 * `--shell-wide` the rails are not rendered to the person at all and what is
 * left is the phone layout exactly as it was.
 */
export function AppShell({
  banner,
  nav,
  aside,
  children,
}: {
  /** The thin bar across the top. Desktop only; see AppShell.css. */
  banner?: ReactNode;
  /** The left rail. Omitted on a screen with nowhere to navigate. */
  nav?: ReactNode;
  /** The right rail. Omitted on a screen with nothing to put beside it. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      {banner ? <div className="shell__banner">{banner}</div> : null}
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
