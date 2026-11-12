import { useEffect, useRef, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { AnsweredRail } from "../components/AnsweredRail.js";
import { ViewState } from "../components/ViewState.js";
import { Button } from "../components/Button.js";
import { LoadMore } from "../components/LoadMore.js";
import { usePollList } from "../hooks/use-poll-list.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import "./Browse.css";

export function Browse({
  api,
  community,
}: {
  api: PulseApi;
  community: string;
}) {
  const { data, more, loadMore, retry } = usePollList(api, community);
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
      <div className="browse__layout">
        <AnsweredRail
          data={mine.data}
          votes={mine.data.status === "ready" ? mine.data.value.votes : []}
          railRetried={railRetried}
          onRetry={() => {
            setRailRetried(true);
            mine.retry();
          }}
        />
        <main className="welcome__main browse__main">
          <h1 ref={heading} tabIndex={-1}>
            Explore questions
          </h1>
          <p className="welcome__note">
            {community === "pulse-general"
              ? "General"
              : `Community: ${community}`}{" "}
            · Newest first · Open and closed questions
          </p>
          <ViewState data={data}>
            {(page) => (
              <ul ref={list} className="browse__list">
                {page.polls.map((p) => (
                  <li key={p.id}>
                    <a href={pathOf({ kind: "conversation", pollId: p.id })}>
                      {p.question}
                    </a>
                    <span>{p.open ? "Open" : "Closed · View results"}</span>
                  </li>
                ))}
              </ul>
            )}
          </ViewState>
          {data.status === "error" ? (
            <Button
              variant="secondary"
              size="small"
              className="browse__action"
              type="button"
              onClick={retry}
            >
              Try again
            </Button>
          ) : null}
          <LoadMore
            more={more}
            hasMore={data.status === "ready" && data.value.nextCursor !== null}
            itemCount={data.status === "ready" ? data.value.polls.length : 0}
            listRef={list}
            onLoadMore={loadMore}
          />
        </main>
      </div>
    </div>
  );
}
