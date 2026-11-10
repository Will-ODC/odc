import { pathOf } from "../flow/route.js";
import { TopBanner } from "../components/TopBanner.js";
import { SignedIn } from "../components/SignedIn.js";
import { ForgetVotes } from "../components/ForgetVotes.js";
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
  /** A failed or pending read must not remove the safe way to forget votes. */
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
  const where = {
    homeHref: pathOf({ kind: "browse", community: "pulse-general" }),
    postHref: pathOf({ kind: "newPoll" }),
    ...(onPostPage
      ? { currentHref: "/new" }
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
                        <p role="alert">{voteRead.message}</p>
                        <button type="button" onClick={voteRead.onRetry}>
                          Try again
                        </button>
                      </>
                    ) : null}
                    <ForgetVotes
                      progress={progress}
                      onForget={onSignOut}
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
