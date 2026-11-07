import { useEffect, useRef, useState } from "react";
import { ApiError, type MyVotesPage, type PulseApi } from "../api/types.js";
import type { ViewData } from "./view-data.js";

type More =
  { status: "idle" | "loading" } | { status: "error"; message: string };

const EMPTY = "No votes saved in this browser yet.";
const message = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : "We couldn't load your votes. Try again.";

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

  function clear() {
    // Drops any read still in flight, so it cannot put the votes back.
    ++generation.current;
    busy.current = false;
    setMore({ status: "idle" });
    setData({ status: "empty", message: EMPTY });
  }

  return { data, more, loadMore, clear, retry: () => retry((n) => n + 1) };
}

function asView(page: MyVotesPage): ViewData<MyVotesPage> {
  return page.votes.length === 0 && page.nextCursor === null
    ? { status: "empty", message: EMPTY }
    : { status: "ready", value: page };
}
