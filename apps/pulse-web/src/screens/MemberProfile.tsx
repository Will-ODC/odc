import { useCallback, useRef } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionPage,
  type ContributionSummary,
  type ContributionsApi,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { LoadMore } from "../components/LoadMore.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { pathOf } from "../flow/route.js";
import { contributionStatuses } from "../flow/contributions.js";
import { useMemberProfile } from "../hooks/use-member-profile.js";
import { usePagedList } from "../hooks/use-paged-list.js";
import { useProfileOwner } from "../hooks/use-profile-owner.js";
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
  const owner = useProfileOwner(api, publicId);
  const ownerAccountId = owner.accountId;
  const loadPublic = useCallback(
    (cursor?: string) => contributions.forProfile(publicId, cursor),
    [contributions, publicId],
  );
  // `owner.check` is a dependency on purpose: a fresh owner check reads the
  // owner list again, even when it found the same account.
  const loadMine = useCallback(
    (cursor?: string) => contributions.mine(cursor, ownerAccountId),
    [contributions, ownerAccountId, owner.check],
  );
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
              {!owner.checked ? null : ownerAccountId !== undefined ? (
                <>
                  <Button variant="primary" href="/contributions/new">
                    Start a contribution
                  </Button>
                  {/* The owner's own list replaces the public one: the same
                      rows, with the controls to manage each. A refused read
                      (such as an account switch) checks the owner again. */}
                  <ProfileContributions
                    key="mine"
                    title="Your contributions"
                    load={loadMine}
                    onRetry={owner.recheck}
                    manage
                  />
                </>
              ) : (
                <ProfileContributions
                  key="public"
                  title="Contributions"
                  load={loadPublic}
                />
              )}
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

const keyOf = (item: ContributionSummary) => item.id;

function ProfileContributions({
  title,
  load,
  onRetry,
  manage = false,
}: {
  title: string;
  load: (cursor?: string) => Promise<ContributionPage>;
  /** Replaces reading the first page again, when the caller must recheck first. */
  onRetry?: () => void;
  manage?: boolean;
}) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await load(cursor);
      return { items: page.contributions, nextCursor: page.nextCursor };
    },
    [load],
  );
  const { data, more, loadMore, retry } = usePagedList({
    fetchPage,
    keyOf,
    emptyMessage: manage
      ? "You haven’t published a contribution yet."
      : "No contributions published yet.",
    errorMessage: "We couldn’t load these contributions. Try again.",
    moreErrorMessage: "Could not load more contributions. Try again.",
  });
  const list = useRef<HTMLUListElement>(null);
  return (
    <section className="profile__contributions">
      <h2>{title}</h2>
      <ViewState data={data} variant="compact">
        {(page) => (
          <ul className="profile__contribution-list" ref={list}>
            {page.items.map((item) => {
              const href = `/contributions/${encodeURIComponent(item.id)}`;
              return (
                <li key={item.id}>
                  <a className="profile__contribution-title" href={href}>
                    {item.title}
                  </a>
                  <span className="profile__contribution-status">
                    {contributionStatuses[item.status]}
                  </span>
                  {manage ? (
                    <span className="profile__manage-links">
                      <Button
                        variant="secondary"
                        size="small"
                        href={`${href}#updates`}
                      >
                        Post an update
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        href={`${href}#messages`}
                      >
                        Organizer inbox
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ViewState>
      {data.status === "error" ? (
        <Button
          variant="secondary"
          size="small"
          type="button"
          onClick={onRetry ?? retry}
        >
          Try again
        </Button>
      ) : null}
      <LoadMore
        more={more}
        hasMore={data.status === "ready" && data.value.nextCursor !== null}
        itemCount={data.status === "ready" ? data.value.items.length : 0}
        listRef={list}
        onLoadMore={loadMore}
        itemSelector=".profile__contribution-title"
        moreLabel="more contributions"
      />
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
