import type { PulseApi } from "../api/types.js";
import { useSession } from "../hooks/use-session.js";
import { SiteBanner } from "./SiteBanner.js";

/** Account wiring for pages without their own voting or posting session. */
export function PageBanner({
  api,
  currentHref,
  signInHref,
}: {
  api: PulseApi;
  currentHref?: string;
  signInHref?: string;
}) {
  const { session, progress, signOut, dismiss } = useSession(api);
  return (
    <SiteBanner
      session={session}
      progress={progress}
      holdsVotes={false}
      onSignOut={signOut}
      onCancel={dismiss}
      {...(currentHref ? { currentHref } : {})}
      {...(signInHref !== undefined ? { signInHref } : {})}
    />
  );
}
