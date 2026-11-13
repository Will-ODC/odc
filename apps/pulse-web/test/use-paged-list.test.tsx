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

it("keeps retry stable across renders", async () => {
  const fetchPage = vi.fn(async () => page([row("one")], null));
  const { result, rerender } = renderHook(() =>
    usePagedList(options(fetchPage)),
  );
  await waitFor(() => expect(result.current.data.status).toBe("ready"));
  const retry = result.current.retry;
  rerender();
  expect(result.current.retry).toBe(retry);
});

it("waits until enabled before reading the first page", async () => {
  const fetchPage = vi.fn(async () => page([row("one")], "next"));
  const { result, rerender } = renderHook(
    ({ enabled }) => usePagedList({ ...options(fetchPage), enabled }),
    { initialProps: { enabled: false } },
  );
  act(() => result.current.loadMore());
  expect(fetchPage).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.data.status).toBe("ready"));
  expect(fetchPage).toHaveBeenCalledExactlyOnceWith();
});

it("drops an in-flight later page when disabled and reads fresh on re-enable", async () => {
  let finish!: (value: PagedListPage<Row>) => void;
  const fetchPage = vi
    .fn<(cursor?: string) => Promise<PagedListPage<Row>>>()
    .mockResolvedValueOnce(page([row("one")], "next"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(page([row("fresh")]));
  const { result, rerender } = renderHook(
    ({ enabled }) => usePagedList({ ...options(fetchPage), enabled }),
    { initialProps: { enabled: true } },
  );
  await waitFor(() => expect(result.current.data.status).toBe("ready"));
  act(() => result.current.loadMore());
  rerender({ enabled: false });
  await act(async () => finish(page([row("late")])));
  expect(result.current.data).toMatchObject({
    status: "ready",
    value: { items: [row("one")] },
  });
  act(() => result.current.loadMore());
  expect(fetchPage).toHaveBeenCalledTimes(2);
  rerender({ enabled: true });
  await waitFor(() =>
    expect(result.current.data).toMatchObject({
      status: "ready",
      value: { items: [row("fresh")], nextCursor: null },
    }),
  );
});

it.each(["first", "later"])(
  "clear drops an in-flight %s page until retry",
  async (which) => {
    let finish!: (value: PagedListPage<Row>) => void;
    const pending = () =>
      new Promise<PagedListPage<Row>>((resolve) => {
        finish = resolve;
      });
    const fetchPage = vi.fn<(cursor?: string) => Promise<PagedListPage<Row>>>();
    if (which === "later")
      fetchPage.mockResolvedValueOnce(page([row("one")], "next"));
    fetchPage
      .mockImplementationOnce(pending)
      .mockResolvedValueOnce(page([row("fresh")]));
    const { result } = renderHook(() => usePagedList(options(fetchPage)));
    if (which === "later") {
      await waitFor(() => expect(result.current.data.status).toBe("ready"));
      act(() => result.current.loadMore());
    }
    act(() => result.current.clear());
    await act(async () => finish(page([row("late")])));
    expect(result.current.data).toEqual({
      status: "empty",
      message: "Nothing here.",
    });
    expect(result.current.more).toEqual({ status: "idle" });
    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.data).toMatchObject({
        status: "ready",
        value: { items: [row("fresh")] },
      }),
    );
  },
);
