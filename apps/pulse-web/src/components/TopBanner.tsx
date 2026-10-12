import type { ReactNode } from "react";
import "./TopBanner.css";

/**
 * The thin bar across the top of the page.
 *
 * Signing in used to be a link at the foot of the left rail, which put the
 * one thing a person might come back to do in the quietest corner of the
 * page. It belongs across the top, where a website keeps it.
 *
 * Desktop only, by the same rule as the rails: at phone width the screen IS
 * the app and there is no page chrome to hang a bar on. AppShell.css hides
 * it there.
 */
export function TopBanner({
  signInHref,
  identity,
  aside,
}: {
  /**
   * Where "Sign in" goes. Left out on the sign-in screens themselves, where
   * the link would only reload the page the person is already on.
   */
  signInHref?: string;
  /**
   * Who is signed in, when anybody is — the mark and the address.
   *
   * A slot rather than a component, because what goes here is the one part
   * of this bar that is still being decided: signing in turns the privacy
   * mark from the anonymous one into the recognised one, and that art does
   * not exist yet. Until it does, nothing is rendered here and the bar
   * offers the way in.
   */
  identity?: ReactNode;
  /**
   * Something to offer beside the way in, for someone who is not signed in —
   * today only "Forget my votes here". Ignored once `identity` is given.
   */
  aside?: ReactNode;
}) {
  return (
    <div className="banner">
      <span className="banner__brand">
        <i aria-hidden="true" />
        pulse
      </span>

      {identity ?? (
        <span className="banner__end">
          {aside}
          {signInHref ? (
            <a className="banner__sign-in" href={signInHref}>
              Sign in
            </a>
          ) : null}
        </span>
      )}
    </div>
  );
}
