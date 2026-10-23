import { useState } from "react";
import type { ReactNode } from "react";
import type { PulseApi } from "./api/types.js";
import type { Route } from "./flow/route.js";
import { FIRST_POLL_ID, pathOf } from "./flow/route.js";
import { browserStore, takeReturn } from "./flow/sign-in-return.js";
import { AppShell } from "./components/AppShell.js";
import { PageBanner } from "./screens/PageBanner.js";
import { useRoute } from "./hooks/use-route.js";
import { Conversation } from "./screens/Conversation.js";
import { ChatPreview } from "./screens/ChatPreview.js";
import { Redeem } from "./screens/Redeem.js";
import { SignIn } from "./screens/SignIn.js";
import { About } from "./screens/About.js";
import { Progress } from "./screens/Progress.js";
import {
  FoundationQuestions,
  type RelatedPollIds,
} from "./screens/FoundationQuestions.js";
import { Trust } from "./screens/Trust.js";
import { Browse } from "./screens/Browse.js";
import { NewPoll } from "./screens/NewPoll.js";
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
export function App({
  api,
  route,
  firstPollId,
  relatedPollIds,
}: {
  api: PulseApi;
  route?: Route;
  firstPollId?: string;
  relatedPollIds?: RelatedPollIds;
}) {
  const browser = useRoute();
  const at = route ?? browser.route;
  /**
   * Set only when the emailed link returns to the posting form: then, and
   * only then, the form brings back a draft kept when its post needed a
   * sign-in. Anyone opening /new any other way starts empty.
   */
  const [restoreDraft, setRestoreDraft] = useState(false);
  /**
   * Said once, politely, by a status region that outlives the screens: the
   * emailed link goes straight on to where the person was, so the screen
   * that spent it is gone before anything on it could be read out.
   */
  const [announced, setAnnounced] = useState("");
  /** The question this browser has just posted, until dismissed or left. */
  const [justPosted, setJustPosted] = useState<string | null>(null);
  if (
    justPosted !== null &&
    !(at.kind === "conversation" && at.pollId === justPosted)
  )
    setJustPosted(null);

  return (
    <>
      <p className="app__announce" role="status">
        {announced}
      </p>
      {screenFor()}
    </>
  );

  function screenFor() {
    switch (at.kind) {
      case "about":
        return (
          <About
            banner={<PageBanner api={api} currentHref="/about" />}
            onStart={() => browser.go({ kind: "progress" })}
          />
        );
      case "progress":
        return (
          <Progress
            banner={<PageBanner api={api} currentHref="/start" />}
            onContinue={() => browser.go({ kind: "questions" })}
          />
        );
      case "browse":
        return <Browse key={at.community} api={api} community={at.community} />;
      case "questions":
        return (
          <FoundationQuestions
            banner={<PageBanner api={api} currentHref="/questions" />}
            {...(firstPollId ? { firstPollId } : {})}
            {...(relatedPollIds ? { relatedPollIds } : {})}
            onChoose={(id) => browser.go({ kind: "conversation", pollId: id })}
          />
        );
      case "signIn":
        return (
          <SignInPage api={api}>
            <SignIn
              api={api}
              {...(at.returnTo ? { returnTo: at.returnTo } : {})}
            />
          </SignInPage>
        );
      case "redeem":
        return (
          <SignInPage api={api}>
            <Redeem
              api={api}
              token={at.token}
              /*
               * Replaced, not pushed: the token is spent the moment it is
               * redeemed, so leaving that URL in the history would hand the back
               * button a link that can now only answer "already used".
               */
              onSignedIn={() => {
                // The question "Confirm with your email" was pressed on, or
                // the posting form, when this browser remembers one (#353).
                const to = takeReturn(browserStore());
                setRestoreDraft(to?.kind === "newPoll");
                setAnnounced("Signed in");
                browser.replace(
                  to ?? { kind: "conversation", pollId: LANDS_ON },
                );
              }}
              onAskAgain={() => browser.replace({ kind: "signIn" })}
            />
          </SignInPage>
        );
      case "conversation":
        return (
          <Conversation
            key={at.pollId}
            api={api}
            pollId={at.pollId}
            // Replaced, so the back button does not return to a page that
            // still believes someone is signed in.
            onSignedOut={() => {
              // "Signed in" is no longer true; leave nothing to read back.
              setAnnounced("");
              browser.replace({ kind: "signIn" });
            }}
            {...(justPosted === at.pollId
              ? {
                  posted: {
                    url: new URL(
                      pathOf({ kind: "conversation", pollId: at.pollId }),
                      globalThis.location.origin,
                    ).href,
                    onDismiss: () => setJustPosted(null),
                  },
                }
              : {})}
          />
        );
      case "chatPreview":
        // Sample data only: the prototype never touches `api`.
        return <ChatPreview />;
      case "trust":
        // Static copy: like the prototype, it never touches `api`.
        return <Trust banner={<PageBanner api={api} currentHref="/trust" />} />;
      case "newPoll":
        return (
          <NewPoll
            api={api}
            signInHref={pathOf({
              kind: "signIn",
              returnTo: { kind: "newPoll" },
            })}
            onPosted={(poll) => {
              setJustPosted(poll.id);
              browser.go({ kind: "conversation", pollId: poll.id });
            }}
            restoreDraft={restoreDraft}
          />
        );
    }
  }
}

/**
 * The page both sign-in screens stand in: the same bar and centre column the
 * ballot has, so a wide window shows one website rather than a phone frame
 * pinned to its left edge. No rails, because there is nothing to navigate
 * while signing in, and no "Sign in" link in the bar, because this is it.
 */
function SignInPage({ children, api }: { children: ReactNode; api: PulseApi }) {
  return (
    <AppShell banner={<PageBanner api={api} signInHref="" />}>
      {children}
    </AppShell>
  );
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
