import type { ReactNode } from "react";
import "./ScreenFrame.css";

/**
 * The phone-sized pane a screen sits in, with pulse's mark on it.
 *
 * Presentational and screen-agnostic: it takes what to draw and draws it. The
 * body is one centred column, which is what every screen that is not a ballot
 * wants — a sentence, a field, a button.
 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  return (
    <section className="screen">
      <div className="screen__mark">
        <div className="screen__brand">
          <i aria-hidden="true" /> pulse
        </div>
      </div>
      <div className="screen__body">{children}</div>
    </section>
  );
}
