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
  const redeemed = useRedeem(api, token);

  /*
   * A spent, expired or unknown link is `empty`, not `error`: nothing is
   * broken, the link has simply run out, and the server already writes the
   * sentence that says so and what to do about it. `<ViewState>` shows that
   * sentence, and this adds the control it tells them to press.
   */
  if (redeemed.status === "empty" || redeemed.status === "error") {
    return (
      <ScreenFrame>
        <h1 className="signin__title">That link did not work.</h1>
        <p className="signin__lede">{redeemed.message}</p>
        <button className="signin__go" type="button" onClick={onAskAgain}>
          Ask for a new link
        </button>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <ViewState data={redeemed}>
        {(me: Me) => (
          <>
            <h1 className="signin__title">You are in.</h1>
            <p className="signin__lede">
              Signed in as <b>{me.email}</b>.
            </p>
            <button className="signin__go" type="button" onClick={onSignedIn}>
              Continue
            </button>
          </>
        )}
      </ViewState>
    </ScreenFrame>
  );
}
