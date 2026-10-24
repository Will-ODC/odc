import { useEffect, useRef, useState } from "react";
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
                  <span className="browse__status">
                    {p.open ? "Open" : "Closed · View results"}
                  </span>
                  <CopyQuestionLink pollId={p.id} question={p.question} />
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

/** Every listed question has a stable direct link, even after its author leaves. */
function CopyQuestionLink({
  pollId,
  question,
}: {
  pollId: string;
  question: string;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const field = useRef<HTMLInputElement>(null);
  const path = pathOf({ kind: "conversation", pollId });
  const url = new URL(path, window.location.href).href;

  useEffect(() => {
    if (copy === "manual") field.current?.select();
  }, [copy]);

  function copyLink() {
    setCopy("idle");
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      setCopy("manual");
      return;
    }
    clipboard.writeText(url).then(
      () => setCopy("copied"),
      () => setCopy("manual"),
    );
  }

  return (
    <div className="browse__share">
      <button
        type="button"
        aria-label={`Copy link to ${question}`}
        onClick={copyLink}
      >
        Copy link
      </button>
      {copy === "manual" ? (
        <input
          ref={field}
          readOnly
          value={url}
          aria-label={`Link to ${question}`}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      <span role="status">
        {copy === "copied"
          ? "Copied"
          : copy === "manual"
            ? "Copy the selected link."
            : ""}
      </span>
    </div>
  );
}
