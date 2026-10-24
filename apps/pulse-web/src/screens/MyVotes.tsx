import { useEffect, useRef, useState } from "react";
import { ApiError, type MyVotesPage, type PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { useSession } from "../hooks/use-session.js";
import { SiteBanner } from "./SiteBanner.js";
import "./Browse.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: MyVotesPage };

/** This browser's current ballots, read from the server on every visit. */
export function MyVotes({ api }: { api: PulseApi }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const forgotten = useRef(false);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clear,
    onForgotten: clear,
  });

  function clear() {
    forgotten.current = true;
    setState({ status: "ready", page: { votes: [], nextCursor: null } });
    setMoreError("");
  }

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    api.myVotes().then(
      (page) => {
        if (active && !forgotten.current) setState({ status: "ready", page });
      },
      (error: unknown) => {
        if (active && !forgotten.current)
          setState({ status: "error", message: failure(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [api, attempt]);

  async function loadMore(page: MyVotesPage) {
    if (more || !page.nextCursor) return;
    setMore(true);
    setMoreError("");
    try {
      const next = await api.myVotes(page.nextCursor);
      if (forgotten.current) return;
      if (next.nextCursor === page.nextCursor)
        throw new Error("repeated cursor");
      const byId = new Map(page.votes.map((vote) => [vote.pollId, vote]));
      next.votes.forEach((vote) => byId.set(vote.pollId, vote));
      setState({
        status: "ready",
        page: { votes: [...byId.values()], nextCursor: next.nextCursor },
      });
    } catch (error) {
      if (!forgotten.current) setMoreError(failure(error));
    } finally {
      setMore(false);
    }
  }

  return (
    <div className="welcome browse">
      <header className="browse__header">
        <SiteBanner
          currentHref="/my-votes"
          session={session}
          progress={progress}
          holdsVotes={state.status === "ready" && state.page.votes.length > 0}
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
        {state.status === "loading" ? (
          <p role="status">Loading your votes…</p>
        ) : null}
        {state.status === "error" ? (
          <div role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          state.page.votes.length === 0 ? (
            <p>
              No votes saved in this browser yet.{" "}
              <a href="/">Explore questions</a>
            </p>
          ) : (
            <>
              <ul className="browse__list">
                {state.page.votes.map((vote) => (
                  <li key={vote.pollId}>
                    <a
                      href={pathOf({
                        kind: "conversation",
                        pollId: vote.pollId,
                      })}
                    >
                      {vote.question}
                    </a>
                    <span>Your answer: {vote.choices.join(", ")}</span>
                    <span>
                      {vote.open
                        ? "Open · You can change your answer"
                        : "Closed · View results"}
                    </span>
                  </li>
                ))}
              </ul>
              {moreError ? <p role="alert">{moreError}</p> : null}
              {state.page.nextCursor ? (
                <button
                  type="button"
                  disabled={more}
                  onClick={() => void loadMore(state.page)}
                >
                  {more ? "Loading more…" : "Load more"}
                </button>
              ) : null}
            </>
          )
        ) : null}
      </main>
    </div>
  );
}

function failure(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "We couldn't load your votes. Try again.";
}
