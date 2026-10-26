import { useEffect, useRef } from "react";
import type { PulseApi } from "../api/types.js";
import { ViewState } from "../components/ViewState.js";
import { pathOf } from "../flow/route.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { SiteBanner } from "./SiteBanner.js";
import "./Browse.css";
import "./MyVotes.css";

/** This browser's current ballots, read from the server on every visit (#329). */
export function MyVotes({ api }: { api: PulseApi }) {
  const { data, more, loadMore, clear, retry } = useMyVotes(api);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clear,
    onForgotten: clear,
  });
  const list = useRef<HTMLUListElement>(null);
  // After Load more, keyboard focus moves to the first new answer, as on Browse.
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (data.status !== "ready" || more.status !== "idle") return;
    if (focusAt.current === null) return;
    const links = list.current?.querySelectorAll("a");
    links?.[Math.min(focusAt.current, links.length - 1)]?.focus();
    focusAt.current = null;
  }, [data, more]);

  return (
    <div className="welcome browse">
      <header className="browse__header">
        <SiteBanner
          currentHref="/my-votes"
          session={session}
          progress={progress}
          holdsVotes={data.status === "ready" && data.value.votes.length > 0}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
      <main className="welcome__main browse__main">
        <h1>My votes</h1>
        <p className="welcome__note">
          Answers saved in this browser. Signing out or forgetting votes here
          clears access to them.
        </p>
        <ViewState data={data}>
          {(page) => (
            <ul ref={list} className="browse__list">
              {page.votes.map((vote) => (
                <li key={vote.pollId}>
                  <a
                    href={pathOf({ kind: "conversation", pollId: vote.pollId })}
                  >
                    {vote.question}
                  </a>
                  <span className="my-votes__detail">
                    Your answer:{" "}
                    {vote.choices.length
                      ? vote.choices.join(", ")
                      : "(answer unavailable)"}
                  </span>
                  <span className="my-votes__detail">
                    {vote.open
                      ? "Open · You can change your answer"
                      : "Closed · View results"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ViewState>
        {data.status === "empty" ? (
          <p>
            <a href="/">Explore questions</a>
          </p>
        ) : null}
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
              focusAt.current = data.value.votes.length;
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
