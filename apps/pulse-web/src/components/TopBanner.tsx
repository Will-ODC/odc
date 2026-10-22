import type { ReactNode } from "react";
import { SiteNavigation } from "./SiteNavigation.js";
import { AccountMenu } from "./AccountMenu.js";
import "./TopBanner.css";

/** Shared site chrome. Screens supply account state; CSS owns the layout. */
export function TopBanner({
  signInHref,
  postHref = "/new",
  homeHref = "/",
  currentHref,
  community,
  account,
}: {
  /** Where the shared posting link goes (ADR-0037). */
  postHref?: string;
  currentHref?: string;
  community?: string | null;
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

      <SiteNavigation
        {...(currentHref ? { currentHref } : {})}
        {...(community ? { community } : {})}
      />
      <span className="banner__actions">
        {postHref ? (
          <a
            className="banner__post"
            href={postHref}
            aria-current={currentHref === postHref ? "page" : undefined}
          >
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
