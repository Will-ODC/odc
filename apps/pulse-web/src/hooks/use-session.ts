import { useCallback, useEffect, useRef, useState } from "react";
import type { Me, PulseApi } from "../api/types.js";
import type { TwoPressProgress } from "../components/TwoPress.js";
import { SIGNED_IN_KEY, browserStore } from "../flow/sign-in-return.js";
import { forgetDraft } from "../flow/draft-store.js";

/**
 * Who is signed in, as far as the bar across the top needs to know.
 *
 * Not `ViewData`: there is no "empty" here. Nobody signed in is an ordinary
 * answer (`me()` turns the 401 into `null`), and an error only means the bar
 * cannot tell, so it offers the way in rather than a sentence about failure.
 */
export type Session =
  | { status: "loading" }
  | {
      status: "signedOut";
      /**
       * How a session this page had came to an end. Absent when this page
       * never saw anyone signed in. "here" and "elsewhere" are someone
       * choosing to sign out (on this page, or in another tab of this
       * browser); "expired" is the server no longer knowing the session with
       * no sign-out announced, which signing in again as the same person can
       * recover from.
       */
      ended?: "here" | "elsewhere" | "expired";
    }
  | { status: "signedIn"; me: Me }
  | { status: "unknown" };

/** Set by a tab that signed out, so other tabs can tell it from an expiry. */
export const SIGNED_OUT_KEY = "pulse.signedOut";

/** How far a sign-out has got: the shape `TwoPress` renders. */
export type SignOutProgress = TwoPressProgress;

/**
 * Ask once who is signed in, and sign them out on request.
 *
 * The session cookies last 30 days, and the API has always offered
 * `POST /api/sign-out`; until this hook nothing on screen called it, so a
 * person on a shared browser had no way to stop the next one being them.
 *
 * The same request serves someone who is not signed in: `POST /api/sign-out`
 * also clears the ballot cookie, which is how "Forget my votes here" works.
 * Which of the two it was decides what runs after: `onSignedOut` for a
 * signed-in person, `onForgotten` for anyone else.
 *
 * Both run only after the server has answered: saying it happened before it
 * did would be the one lie this control could tell.
 */
export function useSession(
  api: PulseApi,
  after: {
    onSignedOut?: () => void;
    onForgotten?: () => void;
    /**
     * Keep asking while signed in, so a switch from account A straight to
     * account B in another tab reaches this page. For pages that show one
     * account's private data, such as a contribution's organizer inbox.
     */
    recheckSignedIn?: boolean;
  } = {},
): {
  session: Session;
  progress: SignOutProgress;
  signOut: () => void;
  /** Forget a failure once the person has put the question away. */
  dismiss: () => void;
} {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [progress, setProgress] = useState<SignOutProgress>({
    status: "idle",
  });

  useEffect(() => {
    let live = true;
    api.me().then(
      (me) => {
        if (live)
          setSession(me ? { status: "signedIn", me } : { status: "signedOut" });
      },
      () => {
        if (live) setSession({ status: "unknown" });
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  /*
   * Ask again when the person comes back to this page, while nobody is signed
   * in here (#353). The confirm offer's Sign in (#480) opens sign-in in another tab,
   * and the emailed link opens a third; signing in there sets the cookie this
   * page shares, but nothing tells this page. Coming back to it - the window
   * regaining focus, or the tab becoming visible - is the moment the answer
   * may have changed and the moment someone will look, so the vote card can
   * say "confirmed by email" without a reload. The tab that spends the link
   * also announces it through storage (`announceSignIn`), which reaches this
   * page even when it never lost focus, as with two windows side by side.
   *
   * Only upgrades: a failed or signed-out answer leaves the session as it
   * was, so a dropped connection never shows a signed-in person as signed out.
   * With `recheckSignedIn` it also asks while signed in, takes a different
   * account's answer, and takes a definite signed-out answer (the person
   * signed out in another tab); the same account's answer changes nothing,
   * and a failed request still changes nothing.
   */
  const recheckSignedIn = after.recheckSignedIn === true;
  const settled =
    recheckSignedIn ||
    session.status === "signedOut" ||
    session.status === "unknown";
  useEffect(() => {
    if (!settled) return;
    let live = true;
    const ask = () => {
      if (document.visibilityState === "hidden") return;
      api.me().then(
        (me) => {
          if (!live) return;
          if (me)
            setSession((current) =>
              current.status === "signedIn" && current.me.id === me.id
                ? current
                : { status: "signedIn", me },
            );
          // A definite "nobody" while signed in: signed out in another tab.
          // A page showing one account's private data must stop showing it.
          // With no sign-out announced, the session ran out (or was revoked):
          // "expired", which the page may let the person recover from.
          else if (recheckSignedIn)
            setSession((current) =>
              current.status === "signedIn"
                ? { status: "signedOut", ended: "expired" }
                : current,
            );
        },
        () => {},
      );
    };
    const announced = (event: StorageEvent) => {
      if (event.key === SIGNED_IN_KEY) ask();
      // Another tab signed out on purpose: not an expiry to recover from.
      else if (event.key === SIGNED_OUT_KEY && recheckSignedIn)
        setSession((current) =>
          current.status === "signedIn" ||
          (current.status === "signedOut" && current.ended === "expired")
            ? { status: "signedOut", ended: "elsewhere" }
            : current,
        );
    };
    window.addEventListener("focus", ask);
    window.addEventListener("storage", announced);
    document.addEventListener("visibilitychange", ask);
    return () => {
      live = false;
      window.removeEventListener("focus", ask);
      window.removeEventListener("storage", announced);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [api, settled, recheckSignedIn]);

  // The hook's own guard, not only the button's: one request at a time.
  const sending = useRef(false);
  const { onSignedOut, onForgotten } = after;
  const signedIn = session.status === "signedIn";

  const signOut = useCallback(() => {
    if (sending.current) return;
    sending.current = true;
    setProgress({ status: "sending" });
    api.signOut().then(
      () => {
        sending.current = false;
        setProgress({ status: "idle" });
        setSession(
          signedIn
            ? { status: "signedOut", ended: "here" }
            : { status: "signedOut" },
        );
        if (signedIn) announceSignOut(browserStore());
        // A posting draft kept in this browser is not for whoever is next.
        forgetDraft(browserStore());
        if (signedIn) onSignedOut?.();
        else onForgotten?.();
      },
      () => {
        sending.current = false;
        setProgress({
          status: "failed",
          message: signedIn
            ? "You are still signed in. Check your connection and try again."
            : "This browser still has your votes. Check your connection and try again.",
        });
      },
    );
  }, [api, signedIn, onSignedOut, onForgotten]);

  const dismiss = useCallback(() => {
    if (!sending.current) setProgress({ status: "idle" });
  }, []);

  return { session, progress, signOut, dismiss };
}

function announceSignOut(store: ReturnType<typeof browserStore>): void {
  if (!store) return;
  try {
    store.setItem(SIGNED_OUT_KEY, String(Date.now()));
  } catch {
    // Storage refused: other tabs treat the sign-out as an expiry.
  }
}
