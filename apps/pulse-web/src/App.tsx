import type { ReactNode } from "react";
import type { PulseApi } from "./api/types.js";
import type { Route } from "./flow/route.js";
import { FIRST_POLL_ID } from "./flow/route.js";
import { AppShell } from "./components/AppShell.js";
import { TopBanner } from "./components/TopBanner.js";
import { useRoute } from "./hooks/use-route.js";
import { Conversation } from "./screens/Conversation.js";
import { ChatPreview } from "./screens/ChatPreview.js";
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
      return (
        <SignInPage>
          <SignIn api={api} />
        </SignInPage>
      );
    case "redeem":
      return (
        <SignInPage>
          <Redeem
            api={api}
            token={at.token}
            /*
             * Replaced, not pushed: the token is spent the moment it is
             * redeemed, so leaving that URL in the history would hand the back
             * button a link that can now only answer "already used".
             */
            onSignedIn={() =>
              browser.replace({ kind: "run", pollId: LANDS_ON })
            }
            onAskAgain={() => browser.replace({ kind: "signIn" })}
          />
        </SignInPage>
      );
    case "run":
      return <Run api={api} pollId={at.pollId} />;
    case "conversation":
      return <Conversation key={at.pollId} api={api} pollId={at.pollId} />;
    case "chatPreview":
      // Sample data only: the prototype never touches `api`.
      return <ChatPreview />;
  }
}

/**
 * The page both sign-in screens stand in: the same bar and centre column the
 * ballot has, so a wide window shows one website rather than a phone frame
 * pinned to its left edge. No rails, because there is nothing to navigate
 * while signing in, and no "Sign in" link in the bar, because this is it.
 */
function SignInPage({ children }: { children: ReactNode }) {
  return <AppShell banner={<TopBanner />}>{children}</AppShell>;
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
