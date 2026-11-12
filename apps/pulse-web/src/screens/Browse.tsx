import { useCallback, useEffect, useRef, useState } from "react";
import {
  contributionsApi,
  type ContributionsApi,
} from "../api/contributions.js";
import type { PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { SuggestedVotesRail } from "../components/SuggestedVotesRail.js";
import { AnsweredRail } from "../components/AnsweredRail.js";
import { ViewState } from "../components/ViewState.js";
import { Button } from "../components/Button.js";
import { usePollList } from "../hooks/use-poll-list.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { useContributionRead } from "../hooks/use-contributions.js";
import { browseItems, type BrowseItem } from "../flow/browse-items.js";
import type { ViewData } from "../hooks/view-data.js";
import "./Browse.css";

export function Browse({
  api,
  community,
  contributionsClient = contributionsApi,
  contributionsOnly = false,
}: {
  api: PulseApi;
  community: string;
  contributionsClient?: Pick<ContributionsApi, "list">;
  contributionsOnly?: boolean;
}) {
  const isGeneral = community === "pulse-general";
  const moreLabel = isGeneral ? "more questions" : "more";
  const loadContributions = useCallback(
    () => (isGeneral ? contributionsClient.list() : Promise.resolve(null)),
    [contributionsClient, isGeneral],
  );
  const {
    data: contributions,
    reload: retryContributions,
    setData: setContributions,
  } = useContributionRead(loadContributions);
  const contributionPaging = useRef(false);
  const [loadingContributions, setLoadingContributions] = useState(false);
  const [contributionPageError, setContributionPageError] = useState(false);
  async function loadMoreContributions() {
    const page = contributions.status === "ready" ? contributions.value : null;
    const cursor = page?.nextCursor;
    if (!page || !cursor || contributionPaging.current) return;
    contributionPaging.current = true;
    setLoadingContributions(true);
    setContributionPageError(false);
    try {
      const next = await contributionsClient.list(cursor);
      if (next.nextCursor === cursor) throw new Error("Cursor did not advance");
      const ids = new Set(page.contributions.map((item) => item.id));
      setContributions({
        status: "ready",
        value: {
          contributions: [
            ...page.contributions,
            ...next.contributions.filter((item) => !ids.has(item.id)),
          ],
          nextCursor: next.nextCursor,
        },
      });
    } catch {
      setContributionPageError(true);
    } finally {
      contributionPaging.current = false;
      setLoadingContributions(false);
    }
  }
  const { data, more, loadMore, retry } = usePollList(
    api,
    community,
    !contributionsOnly,
  );
  const mine = useMyVotes(api);
  const [railRetried, setRailRetried] = useState(false);
  const clearVotes = () => {
    setRailRetried(false);
    mine.clear();
  };
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clearVotes,
    onForgotten: clearVotes,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const list = useRef<HTMLUListElement>(null);
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (
      data.status !== "ready" ||
      more.status !== "idle" ||
      focusAt.current === null
    )
      return;
    const links =
      list.current?.querySelectorAll<HTMLAnchorElement>("a[data-poll]");
    links?.[Math.min(focusAt.current, links.length - 1)]?.focus();
    focusAt.current = null;
  }, [data, more]);
  const contributionRows =
    isGeneral && contributions.status === "ready"
      ? (contributions.value?.contributions ?? [])
      : [];
  const items = browseItems(
    !contributionsOnly && data.status === "ready" ? data.value.polls : [],
    contributionsOnly ? contributionRows : contributionRows.slice(0, 4),
  );
  let feed: ViewData<BrowseItem[]>;
  if (contributionsOnly) {
    feed =
      contributions.status !== "ready"
        ? contributions
        : items.length
          ? { status: "ready", value: items }
          : { status: "empty", message: "No contributions yet." };
  } else if (items.length || data.status === "ready") {
    feed = { status: "ready", value: items };
  } else if (
    isGeneral &&
    data.status === "empty" &&
    contributions.status === "loading"
  ) {
    feed = { status: "loading" };
  } else {
    feed = data;
  }

  return (
    <div className="welcome browse">
      <header className="browse__header">
        <SiteBanner
          currentHref={pathOf({ kind: "browse", community })}
          session={session}
          progress={progress}
          holdsVotes={mine.holdsVotes}
          {...(mine.voteRead ? { voteRead: mine.voteRead } : {})}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
      <main className="browse__layout with-suggested-votes">
        <AnsweredRail
          data={mine.data}
          votes={mine.data.status === "ready" ? mine.data.value.votes : []}
          railRetried={railRetried}
          onRetry={() => {
            setRailRetried(true);
            mine.retry();
          }}
        />
        <div
          className="welcome__main browse__main"
          role="region"
          aria-labelledby="browse-heading"
        >
          <h1 id="browse-heading" ref={heading} tabIndex={-1}>
            {isGeneral ? "Explore" : "Explore questions"}
          </h1>
          <p className="welcome__note">
            {isGeneral
              ? contributionsOnly
                ? "Contributions · Newest first"
                : "General · Newest first"
              : `Community: ${community} · Newest first · Open and closed questions`}
          </p>
          {isGeneral ? (
            <div className="browse__filters">
              <a href={contributionsOnly ? "/" : "/?filter=contributions"}>
                {contributionsOnly ? "Show all" : "Contributions only"}
              </a>
              {contributionsOnly ? (
                <a href="/contributions/new">Start a contribution</a>
              ) : null}
            </div>
          ) : null}
          <ViewState data={feed}>
            {(rows) => (
              <ul ref={list} className="browse__list">
                {rows.map((row) => (
                  <li key={row.key}>
                    {row.tag ? (
                      <span
                        id={`browse-tag-${row.key}`}
                        className="browse__tag"
                      >
                        {row.tag}
                      </span>
                    ) : null}
                    <a
                      href={row.href}
                      aria-describedby={
                        row.tag ? `browse-tag-${row.key}` : undefined
                      }
                      data-poll={row.kind === "poll" ? "" : undefined}
                    >
                      {row.title}
                    </a>
                    <span className="browse__status">{row.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </ViewState>
          {!contributionsOnly && data.status === "error" ? (
            <>
              {items.length ? <p role="status">{data.message}</p> : null}
              <Button
                variant="secondary"
                className="browse__action"
                type="button"
                onClick={retry}
              >
                Try again
              </Button>
            </>
          ) : null}
          {isGeneral && contributions.status === "loading" && items.length ? (
            <p role="status">Loading contributions…</p>
          ) : null}
          {isGeneral && contributions.status === "error" ? (
            <>
              {contributionsOnly ? null : (
                <p role="status">We couldn’t load contributions.</p>
              )}
              <Button
                variant="secondary"
                className="browse__action"
                type="button"
                onClick={() => {
                  heading.current?.focus();
                  retryContributions();
                }}
              >
                Try contributions again
              </Button>
            </>
          ) : null}
          {contributionsOnly && contributionPageError ? (
            <p role="alert">Could not load more contributions. Try again.</p>
          ) : null}
          {contributionsOnly &&
          contributions.status === "ready" &&
          contributions.value?.nextCursor ? (
            <Button
              variant="secondary"
              className="browse__action"
              type="button"
              disabled={loadingContributions}
              onClick={() => void loadMoreContributions()}
            >
              {loadingContributions ? "Loading…" : "Load more contributions"}
            </Button>
          ) : null}
          {!contributionsOnly && more.status === "error" ? (
            <p role="alert">{more.message}</p>
          ) : null}
          {!contributionsOnly &&
          data.status === "ready" &&
          data.value.nextCursor ? (
            <Button
              variant="secondary"
              className="browse__action"
              type="button"
              disabled={more.status === "loading"}
              onClick={() => {
                focusAt.current = data.value.polls.length;
                loadMore();
              }}
            >
              {more.status === "loading"
                ? `Loading ${moreLabel}…`
                : more.status === "error"
                  ? `Try loading ${moreLabel} again`
                  : `Load ${moreLabel}`}
            </Button>
          ) : null}
        </div>
        <SuggestedVotesRail
          api={api}
          history={mine.data}
          retryHistory={mine.retry}
          {...(isGeneral && !contributionsOnly
            ? { source: { data, retry } }
            : {})}
        />
      </main>
    </div>
  );
}
