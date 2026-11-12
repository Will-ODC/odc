import { useEffect, useRef, type RefObject } from "react";
import type { PagedListMore } from "../hooks/use-paged-list.js";
import { Button } from "./Button.js";
import "./LoadMore.css";

/** Cursor-page control shared by lists, including retry copy and focus handoff. */
export function LoadMore({
  more,
  hasMore,
  itemCount,
  listRef,
  onLoadMore,
}: {
  more: PagedListMore;
  hasMore: boolean;
  itemCount: number;
  listRef: RefObject<HTMLElement | null>;
  onLoadMore: () => void;
}) {
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (more.status !== "idle" || focusAt.current === null) return;
    const links = listRef.current?.querySelectorAll("a");
    links?.[Math.min(focusAt.current, links.length - 1)]?.focus();
    focusAt.current = null;
  }, [itemCount, listRef, more]);

  if (!hasMore) return null;
  return (
    <div className="load-more">
      {more.status === "error" ? (
        <p className="load-more__error" role="alert">
          {more.message}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="small"
        className="load-more__button"
        type="button"
        disabled={more.status === "loading"}
        onClick={() => {
          focusAt.current = itemCount;
          onLoadMore();
        }}
      >
        {more.status === "loading"
          ? "Loading more…"
          : more.status === "error"
            ? "Try loading more again"
            : "Load more"}
      </Button>
    </div>
  );
}
