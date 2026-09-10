import { useEffect, useRef, useState } from "react";
import type { Me, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

/**
 * Spend a sign-in token, once.
 *
 * Once is load-bearing rather than tidy. `POST /api/sign-in/redeem` consumes
 * the link, so a second call answers `410 already_used` — and React's
 * StrictMode runs every effect twice in development on purpose. Sending the
 * request twice would tell every developer who clicked a link in dev that it
 * was already used, by their own second request.
 *
 * The request is therefore kept in a ref rather than guarded by a flag: the
 * second run of the effect **re-attaches to the promise the first one made**
 * instead of starting another or bailing out. Bailing out is the trap, and it
 * is not hypothetical — it was the first thing written here. StrictMode's
 * cleanup marks the first run dead, so a second run that returns early leaves
 * nobody listening and the screen sits on "Loading…" forever.
 *
 * The server's non-consuming `GET` exists for the neighbouring problem: mail
 * scanners follow every URL in a message. Nothing here calls it, because by
 * the time this screen renders a person really has clicked.
 */
export function useRedeem(api: PulseApi, token: string): ViewData<Me> {
  const [state, setState] = useState<ViewData<Me>>({ status: "loading" });
  const sent = useRef<{ token: string; answer: Promise<Me> } | null>(null);

  useEffect(() => {
    let live = true;

    if (sent.current?.token !== token) {
      sent.current = { token, answer: api.redeem(token) };
      setState({ status: "loading" });
    }

    sent.current.answer.then(
      (me) => {
        if (live) setState({ status: "ready", value: me });
      },
      (err: unknown) => {
        if (live) setState(failure(err));
      },
    );

    // A token that changes mid-flight must not be overwritten by the answer to
    // the old one.
    return () => {
      live = false;
    };
  }, [api, token]);

  return state;
}

function failure(err: unknown): ViewData<never> {
  /*
   * A link that is spent, expired or not ours is `empty`: it is an answer
   * about the link rather than a fault, and the server's own sentence already
   * says which and tells the person to ask for a new one. Showing that beats
   * anything this file could invent, because only the server knows which of
   * the three it was.
   */
  if (err instanceof ApiError && (err.status === 410 || err.status === 400)) {
    return { status: "empty", message: err.message };
  }
  if (err instanceof ApiError) {
    return { status: "error", message: err.message };
  }
  return {
    status: "error",
    message: "We could not sign you in. Check your connection and try again.",
  };
}
