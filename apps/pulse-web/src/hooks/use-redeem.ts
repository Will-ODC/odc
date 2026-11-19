import { useCallback, useEffect, useRef, useState } from "react";
import type { Me, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

/**
 * Where an emailed sign-in link stands.
 *
 * `ready` is the question, not the answer: the link is good and signs in as
 * `email`, and nothing has been spent. `signingIn` is set from the press until
 * the server answers.
 */
export type RedeemView =
  | ViewData<{ email: string; signingIn: boolean }>
  | { status: "signedIn"; me: Me }
  | { status: "lost" };

/**
 * Read the link on arrival; spend it only when the person says so.
 *
 * GET reads the address. A confirmation event sends the POST, and a ref
 * prevents a second press while it is pending. Retry reads the link again
 * before presenting another confirmation.
 *
 * If the POST's answer never arrives, the server may still have spent the
 * link and set the session cookie. The POST is never sent again; instead
 * `GET /api/me` says whether this browser is now signed in as the address the
 * person agreed to. If so, that is success; if not (or that check fails too),
 * the view is `lost` and the screen offers a new link.
 */
export function useRedeem(
  api: PulseApi,
  token: string,
): { view: RedeemView; confirm: () => void; retry: () => void } {
  const [view, setView] = useState<RedeemView>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const pressed = useRef(false);
  // The token the screen is on now, so a sign-in answer about an older one,
  // or one that lands after the screen is gone, is dropped.
  const current = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    current.current = token;
    pressed.current = false;
    setView({ status: "loading" });
    api.checkLink(token).then(
      (email) => {
        if (live)
          setView({ status: "ready", value: { email, signingIn: false } });
      },
      (err: unknown) => {
        if (live) setView(failure(err));
      },
    );
    return () => {
      live = false;
      current.current = null;
    };
    // `attempt` is a dependency so `retry` can re-run this effect. Never read.
  }, [api, token, attempt]);

  const confirm = useCallback(() => {
    if (view.status !== "ready" || pressed.current) return;
    pressed.current = true;
    const email = view.value.email;
    setView({ status: "ready", value: { email, signingIn: true } });
    api.redeem(token).then(
      (me) => {
        if (current.current === token) setView({ status: "signedIn", me });
      },
      (err: unknown) => {
        if (current.current !== token) return;
        if (!unanswered(err)) {
          setView(failure(err));
          return;
        }
        api.me().then(
          (me) => {
            if (current.current !== token) return;
            setView(
              me !== null && me.email === email
                ? { status: "signedIn", me }
                : { status: "lost" },
            );
          },
          () => {
            if (current.current === token) setView({ status: "lost" });
          },
        );
      },
    );
  }, [api, token, view]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { view, confirm, retry };
}

/** No answer came back, so whether the server acted is unknown. */
function unanswered(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0;
}

function failure(err: unknown): ViewData<never> {
  /*
   * A link that is spent, expired or not ours is `empty`: it is an answer
   * about the link rather than a fault, and the server's own sentence already
   * says which and tells the person to ask for a new one. Showing that beats
   * anything this file could invent, because only the server knows which of
   * the three it was. The GET and the POST answer these the same way.
   *
   * For any other error the link's state is unknown. Offer a fresh GET.
   */
  if (err instanceof ApiError && (err.status === 410 || err.status === 400)) {
    return { status: "empty", message: err.message };
  }
  if (err instanceof ApiError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: "We could not sign you in." };
}
