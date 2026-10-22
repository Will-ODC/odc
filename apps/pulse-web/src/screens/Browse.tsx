import { useEffect, useRef } from "react";
import type { PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { SiteBanner } from "./SiteBanner.js";
import { ViewState } from "../components/ViewState.js";
import { usePollList } from "../hooks/use-poll-list.js";
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
  const { session, progress, signOut, dismiss } = useSession(api);
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
    const links = list.current?.querySelectorAll("a");
    links?.[Math.min(focusAt.current, links.length - 1)]?.focus();
    focusAt.current = null;
  }, [data, more]);
  return (
    <div className="welcome browse">
      <header className="browse__header">
        <SiteBanner
          currentHref={pathOf({ kind: "browse", community })}
          session={session}
          progress={progress}
          holdsVotes={false}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
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
          <button type="button" onClick={retry}>
            Try again
          </button>
        ) : null}
        {more.status === "error" ? <p role="alert">{more.message}</p> : null}
        {data.status === "ready" && data.value.nextCursor ? (
          <button
            type="button"
            disabled={more.status === "loading"}
            onClick={() => {
              focusAt.current = data.value.polls.length;
              loadMore();
            }}
          >
            {more.status === "loading"
              ? "Loading more…"
              : more.status === "error"
                ? "Try loading more again"
                : "Load more"}
          </button>
        ) : null}
      </main>
    </div>
  );
}
