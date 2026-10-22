import { useEffect, useRef } from "react";
import type { PulseApi } from "../api/types.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import { ViewState } from "../components/ViewState.js";
import { useRedeem } from "../hooks/use-redeem.js";
import { announceSignIn, browserStore } from "../flow/sign-in-return.js";
import "./SignIn.css";

/**
 * What the emailed link opens.
 *
 * Spending the token is the only thing this screen does, and it does it once,
 * on arrival — the person already pressed the button, in their mail client.
 *
 * Success goes straight on (operator walkthrough, 2026-10-21): the "You are
 * in · Continue" screen that used to stand here was one press between the
 * person and the form or question they came from. `onSignedIn` decides where
 * that is, replaces the spent link in the history, and says "Signed in"
 * through a status region; the bar there shows the account.
 */
export function Redeem({
  api,
  token,
  onSignedIn,
  onAskAgain,
}: {
  api: PulseApi;
  token: string;
  onSignedIn: () => void;
  onAskAgain: () => void;
}) {
  const { redeemed, retry } = useRedeem(api, token);
  // Tell this browser's other pulse tabs, so a vote card waiting there says
  // "confirmed by email" without a reload (#353).
  const signedIn = redeemed.status === "ready";
  // Once only: `onSignedIn` reads and forgets where to return.
  const gone = useRef(false);
  useEffect(() => {
    if (!signedIn || gone.current) return;
    gone.current = true;
    announceSignIn(browserStore());
    onSignedIn();
  }, [signedIn, onSignedIn]);

  /*
   * The link ran out: spent, expired, or not one of ours.
   *
   * Only the server knows which of the three, and it already writes the
   * sentence that says so and tells the person to ask for a new one. This adds
   * the control that sentence points at — which spends nothing, because there
   * is nothing left to spend.
   */
  if (redeemed.status === "empty") {
    return (
      <Stopped
        title="That link did not work."
        sentence={redeemed.message}
        action="Ask for a new link"
        onAct={onAskAgain}
      />
    );
  }

  /*
   * The request did not get through — the server is down, a proxy answered, the
   * connection dropped. **The link is still good**, and this is the one branch
   * that must not offer to replace it: the token is unspent and sitting in the
   * URL, so throwing it away costs a person their working link and can then run
   * them into the outstanding-link cap, which answers 429. Retrying re-runs the
   * redeem with the token still in hand.
   */
  if (redeemed.status === "error") {
    return (
      <Stopped
        title="We could not reach pulse."
        sentence={`${redeemed.message} Your link is still good.`}
        action="Try again"
        onAct={retry}
      />
    );
  }

  return (
    <ScreenFrame>
      {/* Signed in is gone from here at once; only loading is ever seen. */}
      <ViewState data={redeemed}>{() => null}</ViewState>
    </ScreenFrame>
  );
}

/**
 * The run stopped before it started, and why.
 *
 * One shape for both ways that happens, because they differ in what they say
 * and what the control does, not in how they look. `role="status"` is not
 * decoration here: `<ViewState>` has been announcing "Loading…" through a live
 * region, and without one on the screen that replaces it a screen-reader user
 * is left on "Loading…" and never told the link failed.
 */
function Stopped({
  title,
  sentence,
  action,
  onAct,
}: {
  title: string;
  sentence: string;
  action: string;
  onAct: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <ScreenFrame>
      <div role="status" aria-live="polite">
        <h1 className="signin__title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
        <p className="signin__lede">{sentence}</p>
      </div>
      <button className="signin__go" type="button" onClick={onAct}>
        {action}
      </button>
    </ScreenFrame>
  );
}
