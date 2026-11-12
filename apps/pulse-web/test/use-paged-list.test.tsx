// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  usePagedList,
  type PagedListPage,
} from "../src/hooks/use-paged-list.js";

afterEach(cleanup);

interface Row {
  id: string;
  label: string;
}

const row = (id: string, label = id): Row => ({ id, label });
const page = (
  items: Row[],
  nextCursor: string | null = null,
): PagedListPage<Row> => ({ items, nextCursor });
const keyOf = (item: Row) => item.id;
const options = (fetchPage: (cursor?: string) => Promise<PagedListPage<Row>>) =>
  ({
    fetchPage,
    keyOf,
    emptyMessage: "Nothing here.",
    errorMessage: "Couldn't load it.",
    moreErrorMessage: "Couldn't load more.",
  }) as const;

it("stops a page whose cursor does not advance and keeps the earlier rows", async () => {
  const fetchPage = vi
    .fn<(cursor?: string) => Promise<PagedListPage<Row>>>()
    .mockResolvedValueOnce(page([row("one")], "stuck"))
    .mockResolvedValueOnce(page([row("two")], "stuck"));
  const { result } = renderHook(() => usePagedList(options(fetchPage)));
  await waitFor(() => expect(result.current.data.status).toBe("ready"));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.more.status).toBe("error"));
  expect(result.current.more).toEqual({
    status: "error",
    message: "Couldn't load more.",
  });
  expect(result.current.data).toMatchObject({
    status: "ready",
    value: { items: [row("one")], nextCursor: "stuck" },
  });
});

it("deduplicates later rows by key while retaining their newest value", async () => {
  const fetchPage = vi
    .fn<(cursor?: string) => Promise<PagedListPage<Row>>>()
    .mockResolvedValueOnce(page([row("one", "old"), row("two")], "next"))
    .mockResolvedValueOnce(page([row("one", "new"), row("three")], null));
  const { result } = renderHook(() => usePagedList(options(fetchPage)));
  await waitFor(() => expect(result.current.data.status).toBe("ready"));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.more.status).toBe("idle"));
  expect(result.current.data).toEqual({
    status: "ready",
    value: {
      items: [row("one", "new"), row("two"), row("three")],
      nextCursor: null,
    },
  });
});

it("ignores a first page from a stale generation", async () => {
  let finishOld!: (value: PagedListPage<Row>) => void;
  const oldFetch = vi.fn(
    () =>
      new Promise<PagedListPage<Row>>((resolve) => {
        finishOld = resolve;
      }),
  );
  const newFetch = vi.fn(async () => page([row("new")], null));
  const { result, rerender } = renderHook(
    ({ fetchPage }) => usePagedList(options(fetchPage)),
    { initialProps: { fetchPage: oldFetch } },
  );
  rerender({ fetchPage: newFetch });
  await waitFor(() =>
    expect(result.current.data).toEqual({
      status: "ready",
      value: { items: [row("new")], nextCursor: null },
    }),
  );
  await act(async () => finishOld(page([row("old")], null)));
  expect(result.current.data).toEqual({
    status: "ready",
    value: { items: [row("new")], nextCursor: null },
  });
});
