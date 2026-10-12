import { useCallback, useEffect, useRef, useState } from "react";
import type { Me, PulseApi } from "../api/types.js";
import type { TwoPressProgress } from "../components/TwoPress.js";

/**
 * Who is signed in, as far as the bar across the top needs to know.
 *
 * Not `ViewData`: there is no "empty" here. Nobody signed in is an ordinary
 * answer (`me()` turns the 401 into `null`), and an error only means the bar
 * cannot tell, so it offers the way in rather than a sentence about failure.
 */
export type Session =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; me: Me }
  | { status: "unknown" };

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
  after: { onSignedOut?: () => void; onForgotten?: () => void } = {},
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
        setSession({ status: "signedOut" });
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
