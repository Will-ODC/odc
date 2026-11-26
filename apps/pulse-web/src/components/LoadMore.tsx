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
  itemSelector = "a",
  moreLabel = "more",
  restartLabel,
}: {
  itemSelector?: string;
  moreLabel?: string;
  restartLabel?: string | undefined;
  more: PagedListMore;
  hasMore: boolean;
  itemCount: number;
  listRef: RefObject<HTMLElement | null>;
  onLoadMore: () => void;
}) {
  // The first new row, by position, once the page asked for has arrived.
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (more.status === "loading" || focusAt.current === null) return;
    const first = focusAt.current;
    focusAt.current = null;
    // A failed read leaves focus on the button, which says to try again. A
    // page that added no rows leaves it there too (#605): moving it to the
    // last row the person already had would be a jump for nothing.
    if (more.status === "error" || itemCount <= first) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>(itemSelector);
    rows?.[first]?.focus();
  }, [itemCount, itemSelector, listRef, more]);
  const loading = more.status === "loading";

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
        // Marked, not disabled, while loading: a disabled button would drop
        // keyboard focus to the page (#605).
        aria-disabled={loading || undefined}
        onClick={() => {
          if (loading) return;
          focusAt.current = itemCount;
          onLoadMore();
        }}
      >
        {restartLabel ??
          (loading
            ? `Loading ${moreLabel}…`
            : more.status === "error"
              ? `Try loading ${moreLabel} again`
              : `Load ${moreLabel}`)}
      </Button>
    </div>
  );
}
