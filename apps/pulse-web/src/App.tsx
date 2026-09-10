import type { PulseApi } from "./api/types.js";
import type { Route } from "./flow/route.js";
import { FIRST_POLL_ID } from "./flow/route.js";
import { useRoute } from "./hooks/use-route.js";
import { Redeem } from "./screens/Redeem.js";
import { Run } from "./screens/Run.js";
import { SignIn } from "./screens/SignIn.js";
import "./styles/tokens.css";
import "./App.css";

/**
 * Picks the screen for where we are, and owns no screen markup itself.
 *
 * Three places, and the emailed link is why two of them exist: a person who
 * clicks it arrives holding a token, and before this the app read the URL for
 * `?poll=`, found nothing, and opened the first question — so the link signed
 * nobody in and said nothing about it.
 *
 * `route` is optional so a test can render one screen without driving the
 * browser's history. Left out, the URL decides, which is what the real app
 * wants and what the link depends on.
 */
export function App({ api, route }: { api: PulseApi; route?: Route }) {
  const browser = useRoute();
  const at = route ?? browser.route;

  switch (at.kind) {
    case "signIn":
      return <SignIn api={api} />;
    case "redeem":
      return (
        <Redeem
          api={api}
          token={at.token}
          /*
           * Replaced, not pushed: the token is spent the moment it is
           * redeemed, so leaving that URL in the history would hand the back
           * button a link that can now only answer "already used".
           */
          onSignedIn={() => browser.replace({ kind: "run", pollId: LANDS_ON })}
          onAskAgain={() => browser.replace({ kind: "signIn" })}
        />
      );
    case "run":
      return <Run api={api} pollId={at.pollId} />;
  }
}

/**
 * Where someone lands once they are signed in.
 *
 * A placeholder, and deliberately a named one. What this should be is a
 * three-way decision — continue a run already started, start the story if
 * they never did, or go to the home feed if they have been through or skipped
 * it — and none of the three is possible yet: nothing persists where a run
 * got to, and there is no home to go to. Until both land, signing in returns
 * to the first question, which is at least where the app already opens.
 */
const LANDS_ON = FIRST_POLL_ID;
