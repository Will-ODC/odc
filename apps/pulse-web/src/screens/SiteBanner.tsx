import { pathOf } from "../flow/route.js";
import { TopBanner } from "../components/TopBanner.js";
import { SignedIn } from "../components/SignedIn.js";
import { ForgetVotes } from "../components/ForgetVotes.js";
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
  onPostPage = false,
  onSignOut,
  onCancel,
}: {
  session: Session;
  progress: SignOutProgress;
  /** Whether this browser holds votes someone could forget. */
  holdsVotes: boolean;
  /**
   * On the posting form itself: no "Post a question" (it would loop), and
   * the mark links home instead.
   */
  onPostPage?: boolean;
  onSignOut: () => void;
  onCancel: () => void;
}) {
  const signInHref = pathOf({ kind: "signIn" });
  const where = onPostPage
    ? { homeHref: pathOf({ kind: "welcome" }) }
    : { postHref: pathOf({ kind: "newPoll" }) };
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
          signInHref={signInHref}
          {...(holdsVotes
            ? {
                account: (
                  <>
                    <a className="banner__sign-in" href={signInHref}>
                      Sign in
                    </a>
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
