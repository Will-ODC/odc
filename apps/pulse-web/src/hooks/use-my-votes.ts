import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type MyVotesPage, type PulseApi } from "../api/types.js";
import type { ViewData } from "./view-data.js";

type More =
  { status: "idle" | "loading" } | { status: "error"; message: string };

/** Header recovery when whether this browser holds votes is still unknown. */
export type VoteRead =
  | { status: "loading" }
  | { status: "error"; message: string; onRetry: () => void };

export const MY_VOTES_EMPTY = "No votes saved in this browser yet.";
export const MY_VOTES_ERROR = "We couldn't load your votes. Try again.";
const message = (err: unknown) =>
  err instanceof ApiError ? err.message : MY_VOTES_ERROR;

/**
 * This browser's saved answers (#329), read from the server on every visit,
 * with Load more. A page may arrive short or even empty and still have more
 * after it (API.md), so "empty" means no entries *and* no next page.
 * `clear` empties the list at once, for sign-out and forgetting votes.
 */
export function useMyVotes(api: PulseApi) {
  const [data, setData] = useState<ViewData<MyVotesPage>>({
    status: "loading",
  });
  const [more, setMore] = useState<More>({ status: "idle" });
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    setData({ status: "loading" });
    setMore({ status: "idle" });
    api.myVotes().then(
      (page) => {
        if (generation.current === current) setData(asView(page));
      },
      (err: unknown) => {
        if (generation.current === current)
          setData({ status: "error", message: message(err) });
      },
    );
    return () => {
      ++generation.current;
    };
  }, [api, attempt]);

  function loadMore() {
    if (busy.current || data.status !== "ready" || !data.value.nextCursor)
      return;
    busy.current = true;
    setMore({ status: "loading" });
    const current = generation.current;
    const previous = data.value;
    api.myVotes(previous.nextCursor!).then(
      (page) => {
        if (generation.current !== current) return;
        busy.current = false;
        if (page.nextCursor === previous.nextCursor) {
          setMore({
            status: "error",
            message: "We couldn't load more of your votes. Try again.",
          });
          return;
        }
        const rows = new Map(previous.votes.map((vote) => [vote.pollId, vote]));
        page.votes.forEach((vote) => rows.set(vote.pollId, vote));
        setData(
          asView({ votes: [...rows.values()], nextCursor: page.nextCursor }),
        );
        setMore({ status: "idle" });
      },
      (err: unknown) => {
        if (generation.current !== current) return;
        busy.current = false;
        setMore({ status: "error", message: message(err) });
      },
    );
  }

  const clear = useCallback(() => {
    // Drops any read still in flight, so it cannot put the votes back.
    ++generation.current;
    busy.current = false;
    setMore({ status: "idle" });
    setData({ status: "empty", message: MY_VOTES_EMPTY });
  }, []);

  const retryRead = () => retry((n) => n + 1);
  const voteRead: VoteRead | undefined =
    data.status === "loading"
      ? { status: "loading" }
      : data.status === "error"
        ? { status: "error", message: data.message, onRetry: retryRead }
        : undefined;

  return {
    data,
    more,
    loadMore,
    clear,
    // A cursor-only page still means this browser holds saved votes. Every
    // page derives its header from this same server-backed source (#487).
    holdsVotes: data.status === "ready",
    voteRead,
    retry: retryRead,
  };
}

function asView(page: MyVotesPage): ViewData<MyVotesPage> {
  return page.votes.length === 0 && page.nextCursor === null
    ? { status: "empty", message: MY_VOTES_EMPTY }
    : { status: "ready", value: page };
}
