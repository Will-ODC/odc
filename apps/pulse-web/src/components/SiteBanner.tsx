import { useEffect, useRef } from "react";
import { pathOf } from "../flow/route.js";
import { TopBanner } from "./TopBanner.js";
import { SignedIn } from "./SignedIn.js";
import { ForgetVotes } from "./ForgetVotes.js";
import { Button } from "./Button.js";
import type { VoteRead } from "../hooks/use-my-votes.js";
import type { Session, SignOutProgress } from "../hooks/use-session.js";

/**
 * The bar across the top, for whoever is (or is not) signed in: the
 * conversation's and the posting form's. Not a routed screen; it lives with
 * them because it reads the session they hold (`useSession`).
 *
 * Nothing on the right while asking: a "Sign in" link that turns into an
 * account button a moment later is the flicker this avoids. When the answer
 * is unknown, the way in is offered, because signing in again is harmless.
 *
 * One account control (operator walkthrough, 2026-10-21): "Sign in" for
 * someone with nothing else to do here, otherwise the account button with
 * the rest behind it.
 */
export function SiteBanner({
  session,
  progress,
  holdsVotes,
  voteRead,
  onPostPage = false,
  currentHref,
  signInHref = pathOf({ kind: "signIn" }),
  onSignOut,
  onCancel,
}: {
  session: Session;
  progress: SignOutProgress;
  /** Whether this browser holds votes someone could forget. */
  holdsVotes: boolean;
  /** Only a failed read or its retry keeps the recovery controls visible. */
  voteRead?: VoteRead;
  /**
   * Mark the shared posting link as the current page.
   */
  onPostPage?: boolean;
  currentHref?: string;
  signInHref?: string;
  onSignOut: () => void;
  onCancel: () => void;
}) {
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const signInLink = useRef<HTMLAnchorElement>(null);
  const retryFocus = useRef(false);
  const forgetFocus = useRef(false);
  useEffect(() => {
    if (!forgetFocus.current || progress.status === "sending") return;
    if (progress.status === "failed") {
      forgetFocus.current = false;
      return;
    }
    if (holdsVotes || voteRead) return;
    forgetFocus.current = false;
    // Forget removes the account controls. Follow them to Sign in only
    // when focus was lost, preserving any move elsewhere during the request.
    if (document.activeElement === document.body) signInLink.current?.focus();
  }, [holdsVotes, voteRead, progress.status]);
  useEffect(() => {
    if (!retryFocus.current || voteRead) return;
    retryFocus.current = false;
    // An empty result removes the focused Account trigger. Follow it to
    // Sign in, unless the person has already moved focus elsewhere.
    if (document.activeElement === document.body) signInLink.current?.focus();
  }, [voteRead]);
  const where = {
    accountTriggerRef: accountTrigger,
    signInRef: signInLink,
    homeHref: pathOf({ kind: "browse", community: "pulse-general" }),
    postHref: pathOf({ kind: "newPoll" }),
    ...(onPostPage
      ? { currentHref: pathOf({ kind: "newPoll" }) }
      : currentHref
        ? { currentHref }
        : {}),
    ...(session.status === "signedIn"
      ? { community: session.me.community }
      : {}),
  };
  switch (session.status) {
    case "loading":
      return <TopBanner {...where} />;
    case "signedIn":
      return (
        <TopBanner
          {...where}
          account={
            <SignedIn
              email={session.me.email}
              progress={progress}
              onSignOut={onSignOut}
              onCancel={onCancel}
            />
          }
        />
      );
    case "signedOut":
    case "unknown":
      if (voteRead?.status === "loading" && !voteRead.retrying)
        return <TopBanner {...where} />;
      return (
        <TopBanner
          {...where}
          {...(signInHref ? { signInHref } : {})}
          {...(holdsVotes || voteRead
            ? {
                account: (
                  <>
                    {signInHref ? (
                      <a className="banner__sign-in" href={signInHref}>
                        Sign in
                      </a>
                    ) : null}
                    {voteRead?.status === "loading" ? (
                      <p role="status">Loading your votes…</p>
                    ) : voteRead?.status === "error" ? (
                      <>
                        <p
                          role={
                            currentHref === pathOf({ kind: "myVotes" })
                              ? "status"
                              : "alert"
                          }
                        >
                          {voteRead.message}
                        </p>
                        <Button
                          variant="secondary"
                          size="small"
                          type="button"
                          onClick={() => {
                            retryFocus.current = true;
                            accountTrigger.current?.focus();
                            voteRead.onRetry();
                          }}
                        >
                          Try again
                        </Button>
                      </>
                    ) : null}
                    <ForgetVotes
                      progress={progress}
                      onForget={() => {
                        forgetFocus.current = true;
                        onSignOut();
                      }}
                      onCancel={onCancel}
                    />
                  </>
                ),
              }
            : {})}
        />
      );
  }
}
