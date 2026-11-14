import type { PulseApi } from "../api/types.js";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { pathOf } from "../flow/route.js";
import { useMemberProfile } from "../hooks/use-member-profile.js";
import "./Profile.css";

export function MemberProfile({
  api,
  publicId,
}: {
  api: PulseApi;
  publicId: string;
}) {
  const { state, retry } = useMemberProfile(api, publicId);
  const href = pathOf({ kind: "memberProfile", publicId });
  return (
    <AppShell banner={<PageBanner api={api} currentHref={href} />}>
      <article className="profile profile--public">
        <ViewState data={state} variant="compact">
          {(profile) => (
            <>
              <p className="profile__eyebrow">Pulse member</p>
              <h1 className="profile__title">{profile.displayName}</h1>
              {profile.bio ? (
                <p className="profile__bio">{profile.bio}</p>
              ) : null}
              <p className="profile__date">
                Profile created {formatDate(profile.createdAt)}
              </p>
            </>
          )}
        </ViewState>
        {state.status === "error" ? (
          <Button variant="secondary" type="button" onClick={retry}>
            Try again
          </Button>
        ) : null}
        {state.status === "empty" ? (
          <Button variant="secondary" href="/">
            Go to Pulse home
          </Button>
        ) : null}
      </article>
    </AppShell>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
