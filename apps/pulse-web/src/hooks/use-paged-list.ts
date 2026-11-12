import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

export interface PagedListPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type PagedListMore =
  { status: "idle" | "loading" } | { status: "error"; message: string };

interface PagedListOptions<T> {
  fetchPage: (cursor?: string) => Promise<PagedListPage<T>>;
  keyOf: (item: T) => string;
  emptyMessage: string;
  errorMessage: string;
  moreErrorMessage: string;
}

const messageFor = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/** Shared cursor paging, including stale-read, duplicate and stuck-cursor guards. */
export function usePagedList<T>({
  fetchPage,
  keyOf,
  emptyMessage,
  errorMessage,
  moreErrorMessage,
}: PagedListOptions<T>) {
  const [data, setData] = useState<ViewData<PagedListPage<T>>>({
    status: "loading",
  });
  const [more, setMore] = useState<PagedListMore>({ status: "idle" });
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    setData({ status: "loading" });
    setMore({ status: "idle" });
    fetchPage().then(
      (page) => {
        if (generation.current !== current) return;
        setData(
          page.items.length === 0 && page.nextCursor === null
            ? { status: "empty", message: emptyMessage }
            : { status: "ready", value: page },
        );
      },
      (error: unknown) => {
        if (generation.current === current)
          setData({
            status: "error",
            message: messageFor(error, errorMessage),
          });
      },
    );
    return () => {
      ++generation.current;
    };
  }, [attempt, emptyMessage, errorMessage, fetchPage]);

  const loadMore = useCallback(() => {
    if (busy.current || data.status !== "ready" || !data.value.nextCursor)
      return;
    const cursor = data.value.nextCursor;
    busy.current = true;
    setMore({ status: "loading" });
    const current = generation.current;
    const previous = data.value;
    fetchPage(cursor).then(
      (page) => {
        if (generation.current !== current) return;
        busy.current = false;
        if (page.nextCursor === cursor) {
          setMore({ status: "error", message: moreErrorMessage });
          return;
        }
        const items = new Map(
          previous.items.map((item) => [keyOf(item), item]),
        );
        page.items.forEach((item) => items.set(keyOf(item), item));
        setData({
          status: "ready",
          value: { items: [...items.values()], nextCursor: page.nextCursor },
        });
        setMore({ status: "idle" });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        busy.current = false;
        setMore({
          status: "error",
          message: messageFor(error, errorMessage),
        });
      },
    );
  }, [data, errorMessage, fetchPage, keyOf, moreErrorMessage]);

  const clear = useCallback(() => {
    ++generation.current;
    busy.current = false;
    setMore({ status: "idle" });
    setData({ status: "empty", message: emptyMessage });
  }, [emptyMessage]);

  return {
    data,
    more,
    loadMore,
    clear,
    retry: () => retry((value) => value + 1),
    retrying: attempt > 0,
  };
}
