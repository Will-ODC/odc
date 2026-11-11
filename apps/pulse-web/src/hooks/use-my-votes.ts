import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type MyVote,
  type MyVotesPage,
  type PulseApi,
} from "../api/types.js";
import type { ViewData } from "./view-data.js";

type More =
  { status: "idle" | "loading" } | { status: "error"; message: string };

/** First read stays neutral; a retry keeps the error recovery controls. */
export type VoteRead =
  | { status: "loading"; retrying: boolean }
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
      ? { status: "loading", retrying: attempt > 0 }
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

interface Later {
  first: MyVotesPage | undefined;
  rows: MyVote[];
  cursor: string | null;
  failed: boolean;
}

const startOf = (first: MyVotesPage | undefined): Later => ({
  first,
  rows: [],
  cursor: first?.nextCursor ?? null,
  failed: false,
});

/**
 * My votes rows after `first`, read only so a question page can find an older
 * saved answer's place and the row below it (#528). Nothing draws them: the
 * rail keeps its first page and See all my votes. While `wanted`, it reads
 * one page at a time, and starts over when `first` is read again. `more` is
 * whether a cursor is left; a failed or stuck read stops it (`failed`).
 */
export function useLaterVotes(
  api: PulseApi,
  first: MyVotesPage | undefined,
  wanted: boolean,
) {
  const [later, setLater] = useState<Later>(() => startOf(first));
  let current = later;
  if (later.first !== first) {
    current = startOf(first);
    setLater(current);
  }
  const { cursor, failed } = current;
  // The read in flight, so a re-render never asks for the same page twice.
  const reading = useRef<{ first: MyVotesPage; cursor: string } | null>(null);
  useEffect(() => {
    if (!wanted || !first || !cursor || failed) return;
    const asked = reading.current;
    if (asked && asked.first === first && asked.cursor === cursor) return;
    reading.current = { first, cursor };
    const settle = (next: (old: Later) => Later) => {
      if (reading.current?.first === first) reading.current = null;
      setLater((old) =>
        old.first === first && old.cursor === cursor ? next(old) : old,
      );
    };
    api.myVotes(cursor).then(
      (page) =>
        settle((old) =>
          page.nextCursor === cursor
            ? { ...old, failed: true }
            : {
                ...old,
                rows: [...old.rows, ...page.votes],
                cursor: page.nextCursor,
              },
        ),
      () => settle((old) => ({ ...old, failed: true })),
    );
  }, [api, first, cursor, failed, wanted]);
  return {
    rows: current.rows,
    more: current.cursor !== null,
    failed: current.failed,
  };
}

function asView(page: MyVotesPage): ViewData<MyVotesPage> {
  return page.votes.length === 0 && page.nextCursor === null
    ? { status: "empty", message: MY_VOTES_EMPTY }
    : { status: "ready", value: page };
}
