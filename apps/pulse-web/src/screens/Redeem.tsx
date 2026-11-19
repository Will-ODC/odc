import { useEffect, useRef } from "react";
import type { PulseApi } from "../api/types.js";
import { Button, type ButtonVariant } from "../components/Button.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import { ViewState } from "../components/ViewState.js";
import { useRedeem } from "../hooks/use-redeem.js";
import { announceSignIn, browserStore } from "../flow/sign-in-return.js";
import "./SignIn.css";

/**
 * What the emailed link opens.
 *
 * Opening the link signs nobody in (#681). The screen asks the server which
 * address the link is for, says so, and signs in only when the person presses
 * "Continue as <address>". Otherwise anyone could request a link for their own
 * address, get someone else to open it, and have that person's browser and
 * votes silently signed into the sender's account.
 *
 * After the press, success goes straight on (operator walkthrough,
 * 2026-10-21): `onSignedIn` decides where, replaces the spent link in the
 * history, and says "Signed in" through a status region; the bar there shows
 * the account.
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
  const { view, confirm, retry } = useRedeem(api, token);
  // Tell this browser's other pulse tabs, so a vote card waiting there says
  // "confirmed by email" without a reload (#353).
  const signedIn = view.status === "signedIn";
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
   * is nothing left to spend. No Continue: there is nothing to sign in to.
   */
  if (view.status === "empty") {
    return (
      <Stopped
        title="That link did not work."
        sentence={view.message}
        action="Ask for a new link"
        variant="primary"
        onAct={onAskAgain}
      />
    );
  }

  /*
   * The press went out and no answer came back, and this browser is not
   * signed in as the address offered. The link may or may not be spent, and
   * sending it again is not this screen's to do unasked, so it offers the one
   * way forward that does not depend on knowing.
   */
  if (view.status === "lost") {
    return (
      <Stopped
        title="We could not finish signing you in."
        sentence="Pulse did not answer, and this browser is not signed in. Ask for a new link to try again."
        action="Ask for a new link"
        variant="primary"
        onAct={onAskAgain}
      />
    );
  }

  // Retry checks the link again. A lost response may follow a successful
  // redemption, so the screen cannot promise the link is still usable.
  if (view.status === "error") {
    return (
      <Stopped
        title="We could not reach pulse."
        sentence={view.message}
        action="Try again"
        variant="secondary"
        onAct={retry}
      />
    );
  }

  if (view.status === "ready") {
    return (
      <Confirm
        email={view.value.email}
        signingIn={view.value.signingIn}
        onConfirm={confirm}
      />
    );
  }

  return (
    <ScreenFrame>
      {/* Signed in is gone from here at once; only loading is ever seen. */}
      <ViewState data={{ status: "loading" }}>{() => null}</ViewState>
    </ScreenFrame>
  );
}

/**
 * The question the link asks before it spends itself: sign in as this address?
 *
 * The address is in the button's own name, not only in the line above it, so
 * a screen reader landing on the button hears whom it signs in as. Focus goes
 * to the heading, not the button, so a stray Enter on arrival signs nobody in.
 * While the press is answered the button stays focusable and says so through
 * `aria-disabled`; a second press is dropped by the hook.
 */
function Confirm({
  email,
  signingIn,
  onConfirm,
}: {
  email: string;
  signingIn: boolean;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <ScreenFrame>
      <div role="status" aria-live="polite">
        <h1 className="signin__title" tabIndex={-1} ref={heading}>
          Sign in to Pulse
        </h1>
        <p className="signin__lede">
          This link signs you in as{" "}
          <span className="signin__address">{email}</span>.
        </p>
        {signingIn ? <p className="signin__lede">Signing in…</p> : null}
      </div>
      <Button
        variant="primary"
        className="signin__go signin__continue"
        type="button"
        aria-disabled={signingIn ? "true" : undefined}
        onClick={onConfirm}
      >
        Continue as {email}
      </Button>
      <p className="signin__aside">Not you? Close this page.</p>
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
  variant,
  onAct,
}: {
  title: string;
  sentence: string;
  action: string;
  variant: ButtonVariant;
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
      <Button
        variant={variant}
        className="signin__go"
        type="button"
        onClick={onAct}
      >
        {action}
      </Button>
    </ScreenFrame>
  );
}
