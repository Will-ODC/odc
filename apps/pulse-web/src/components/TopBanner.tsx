import type { ReactNode } from "react";
import { AccountMenu } from "./AccountMenu.js";
import "./TopBanner.css";

/**
 * The thin bar across the top of the page.
 *
 * Signing in used to be a link at the foot of the left rail, which put the
 * one thing a person might come back to do in the quietest corner of the
 * page. It belongs across the top, where a website keeps it.
 *
 * The conversation and the posting form show it at every width, so a phone
 * always has a way home; inside `AppShell` alone (the sign-in screens) it is
 * desktop only, because there the frame carries the mark.
 *
 * At most the mark, "Post a question" and ONE account control: three
 * controls wrapped it onto two lines on a 375px phone (operator walkthrough,
 * 2026-10-21).
 */
export function TopBanner({
  signInHref,
  postHref,
  homeHref,
  account,
}: {
  /** Where "Post a question" goes (ADR-0037). Left out where it would loop. */
  postHref?: string;
  /**
   * Where "Sign in" goes. Left out on the sign-in screens themselves, where
   * the link would only reload the page the person is already on. Ignored
   * once `account` is given.
   */
  signInHref?: string;
  /** Makes the mark a link home, on a page that is not home. */
  homeHref?: string;
  /**
   * The account's controls — who is signed in and "Sign out", or "Forget my
   * votes here" — shown behind one small button (`AccountMenu`) in place of
   * the "Sign in" link.
   */
  account?: ReactNode;
}) {
  const mark = (
    <>
      <i aria-hidden="true" />
      pulse
    </>
  );
  return (
    <div className="banner">
      {homeHref ? (
        <a className="banner__brand" href={homeHref}>
          {mark}
        </a>
      ) : (
        <span className="banner__brand">{mark}</span>
      )}

      <span className="banner__actions">
        {postHref ? (
          <a className="banner__post" href={postHref}>
            Post<span className="banner__post-more"> a question</span>
          </a>
        ) : null}

        {account ? (
          <AccountMenu>{account}</AccountMenu>
        ) : signInHref ? (
          <a className="banner__sign-in" href={signInHref}>
            Sign in
          </a>
        ) : null}
      </span>
    </div>
  );
}
