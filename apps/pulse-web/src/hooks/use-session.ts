import { useCallback, useEffect, useState } from "react";
import type { Me, PulseApi } from "../api/types.js";

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

/** How far a sign-out has got. */
export type SignOutProgress =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

/**
 * Ask once who is signed in, and sign them out on request.
 *
 * The session cookies last 30 days, and the API has always offered
 * `POST /api/sign-out`; until this hook nothing on screen called it, so a
 * person on a shared browser had no way to stop the next one being them.
 *
 * `onSignedOut` runs only after the server has answered: sign-out is "every
 * session, everywhere", and saying it happened before it did would be the one
 * lie this control could tell.
 */
export function useSession(
  api: PulseApi,
  onSignedOut?: () => void,
): {
  session: Session;
  progress: SignOutProgress;
  signOut: () => void;
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

  const signOut = useCallback(() => {
    setProgress({ status: "sending" });
    api.signOut().then(
      () => {
        setProgress({ status: "idle" });
        setSession({ status: "signedOut" });
        onSignedOut?.();
      },
      () =>
        setProgress({
          status: "failed",
          message:
            "You are still signed in. Check your connection and try again.",
        }),
    );
  }, [api, onSignedOut]);

  return { session, progress, signOut };
}
