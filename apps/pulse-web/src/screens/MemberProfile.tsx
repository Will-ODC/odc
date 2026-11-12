import { useCallback, useEffect, useRef, useState } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionPage,
  type ContributionsApi,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { pathOf } from "../flow/route.js";
import { contributionStatuses } from "../flow/contributions.js";
import { useMemberProfile } from "../hooks/use-member-profile.js";
import { useContributionRead } from "../hooks/use-contributions.js";
import "./Profile.css";

export function MemberProfile({
  api,
  publicId,
  contributions = contributionsApi,
}: {
  api: PulseApi;
  publicId: string;
  contributions?: Pick<ContributionsApi, "forProfile" | "mine">;
}) {
  const { state, retry } = useMemberProfile(api, publicId);
  const [ownedProfile, setOwnedProfile] = useState<string | null>(null);
  const owner = ownedProfile === publicId;
  const loadPublic = useCallback(
    (cursor?: string) => contributions.forProfile(publicId, cursor),
    [contributions, publicId],
  );
  const loadMine = useCallback(
    (cursor?: string) => contributions.mine(cursor),
    [contributions],
  );
  useEffect(() => {
    let live = true;
    api.myProfile().then(
      (profile) => {
        if (live)
          setOwnedProfile(profile?.visible === true ? profile.publicId : null);
      },
      () => {
        if (live) setOwnedProfile(null);
      },
    );
    return () => {
      live = false;
    };
  }, [api, publicId]);
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
              {owner ? (
                <Button variant="primary" href="/contributions/new">
                  Start a contribution
                </Button>
              ) : null}
              <ProfileContributions title="Contributions" load={loadPublic} />
              {owner ? (
                <ProfileContributions
                  title="Your contributions"
                  load={loadMine}
                  manage
                />
              ) : null}
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

function ProfileContributions({
  title,
  load,
  manage = false,
}: {
  title: string;
  load: (cursor?: string) => Promise<ContributionPage>;
  manage?: boolean;
}) {
  const first = useCallback(() => load(), [load]);
  const { data, reload, setData } = useContributionRead(first);
  const paging = useRef(false);
  const [pageError, setPageError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  async function more() {
    if (data.status !== "ready" || !data.value.nextCursor || paging.current)
      return;
    paging.current = true;
    setLoadingMore(true);
    setPageError(false);
    const current = data.value;
    try {
      const next = await load(current.nextCursor ?? undefined);
      if (next.nextCursor === current.nextCursor)
        throw new Error("Cursor did not advance");
      const ids = new Set(current.contributions.map((item) => item.id));
      setData({
        status: "ready",
        value: {
          contributions: [
            ...current.contributions,
            ...next.contributions.filter((item) => !ids.has(item.id)),
          ],
          nextCursor: next.nextCursor,
        },
      });
    } catch {
      setPageError(true);
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }
  return (
    <section className="profile__contributions">
      <h2>{title}</h2>
      <ViewState data={data} variant="compact">
        {(page) =>
          page.contributions.length ? (
            <ul className="profile__contribution-list">
              {page.contributions.map((item) => {
                const href = `/contributions/${encodeURIComponent(item.id)}`;
                return (
                  <li key={item.id}>
                    <a href={href}>{item.title}</a>
                    <span>{contributionStatuses[item.status]}</span>
                    {manage ? (
                      <span className="profile__manage-links">
                        <a href={`${href}#updates`}>Post an update</a>
                        <a href={`${href}#messages`}>Organizer inbox</a>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>
              {manage
                ? "You haven’t published a contribution yet."
                : "No contributions published yet."}
            </p>
          )
        }
      </ViewState>
      {data.status === "error" ? (
        <Button variant="secondary" size="small" type="button" onClick={reload}>
          Try again
        </Button>
      ) : null}
      {pageError ? (
        <p role="alert">Could not load more contributions. Try again.</p>
      ) : null}
      {data.status === "ready" && data.value.nextCursor ? (
        <Button
          variant="secondary"
          size="small"
          type="button"
          disabled={loadingMore}
          onClick={() => void more()}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </section>
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
