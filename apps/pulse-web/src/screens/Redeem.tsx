import { useEffect, useRef } from "react";
import type { Me, PulseApi } from "../api/types.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import { ViewState } from "../components/ViewState.js";
import { useRedeem } from "../hooks/use-redeem.js";
import "./SignIn.css";

/**
 * What the emailed link opens.
 *
 * Spending the token is the only thing this screen does, and it does it once,
 * on arrival — the person already pressed the button, in their mail client.
 *
 * Success is a screen rather than a redirect. The link is the one moment pulse
 * knows the address it reached, and showing it back is what lets someone catch
 * having signed in as the wrong one; a silent bounce onward would also race
 * the history replace that keeps the spent link out of the back button.
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
      <ViewState data={redeemed}>
        {(me: Me) => <SignedIn me={me} onContinue={onSignedIn} />}
      </ViewState>
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

function SignedIn({ me, onContinue }: { me: Me; onContinue: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The loading region has just been replaced; without moving focus it falls
  // to `document.body` and nothing announces that the person is signed in.
  useEffect(() => heading.current?.focus(), []);

  return (
    <>
      {/*
       * The live region is not decoration. `<ViewState>` has been announcing
       * "Loading…" through one; replacing it with markup that has none leaves
       * a screen-reader user on "Loading…" with no idea they are signed in.
       */}
      <div role="status" aria-live="polite">
        <h1 className="signin__title" tabIndex={-1} ref={heading}>
          You are in.
        </h1>
        <p className="signin__lede">
          Signed in as <b>{me.email}</b>.
        </p>
      </div>
      <button className="signin__go" type="button" onClick={onContinue}>
        Continue
      </button>
    </>
  );
}
