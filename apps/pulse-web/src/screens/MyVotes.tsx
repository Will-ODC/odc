import { useRef } from "react";
import type { PulseApi } from "../api/types.js";
import { AnsweredList } from "../components/AnsweredList.js";
import { ViewState } from "../components/ViewState.js";
import { LoadMore } from "../components/LoadMore.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { pathOf } from "../flow/route.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { Button } from "../components/Button.js";
import "./MyVotes.css";

/** This browser's current ballots, read from the server on every visit (#329). */
export function MyVotes({ api }: { api: PulseApi }) {
  const { data, more, loadMore, clear, retry, holdsVotes, voteRead } =
    useMyVotes(api);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clear,
    onForgotten: clear,
  });
  const list = useRef<HTMLUListElement>(null);

  return (
    <div className="my-votes">
      <header className="my-votes__header">
        <SiteBanner
          currentHref={pathOf({ kind: "myVotes" })}
          session={session}
          progress={progress}
          holdsVotes={holdsVotes}
          {...(voteRead ? { voteRead } : {})}
          onSignOut={signOut}
          onCancel={dismiss}
        />
      </header>
      <main
        className={`my-votes__main${
          data.status === "empty" || data.status === "error"
            ? " my-votes__main--message"
            : ""
        }`}
      >
        <h1>My votes</h1>
        <p className="my-votes__note">
          Answers saved in this browser. Signing out or forgetting votes here
          clears access to them.
        </p>
        <ViewState data={data}>
          {(page) => <AnsweredList votes={page.votes} listRef={list} />}
        </ViewState>
        {data.status === "empty" ? (
          <p className="my-votes__more">
            <a href="/">Explore questions</a>
          </p>
        ) : null}
        {data.status === "error" ? (
          <Button
            variant="secondary"
            size="small"
            className="my-votes__action"
            type="button"
            onClick={retry}
          >
            Try again
          </Button>
        ) : null}
        <LoadMore
          more={more}
          hasMore={data.status === "ready" && data.value.nextCursor !== null}
          itemCount={data.status === "ready" ? data.value.votes.length : 0}
          listRef={list}
          onLoadMore={loadMore}
        />
      </main>
    </div>
  );
}
