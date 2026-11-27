import { useId, useRef } from "react";
import type { ChoiceResult, PublicVote } from "../api/types.js";
import type { PagedListMore, PagedListPage } from "../hooks/use-paged-list.js";
import type { ViewData } from "../hooks/view-data.js";
import { LoadMore } from "./LoadMore.js";
import { ViewState } from "./ViewState.js";

export function PublicVotes({
  choices,
  data,
  more,
  loadMore,
  retry,
}: {
  choices: readonly ChoiceResult[];
  data: ViewData<PagedListPage<PublicVote>>;
  more: PagedListMore;
  loadMore: () => void;
  retry: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const restart = more.status === "error" && more.statusCode === 400;
  const restartFromFirstPage = () => {
    heading.current?.focus();
    retry();
  };
  return (
    <section className="results__public-votes" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="results__title">
        Public votes
      </h3>
      <ViewState data={data} onRetry={restartFromFirstPage}>
        {({ items, nextCursor }) => (
          <>
            <ul ref={list} className="results__list">
              {items.map((vote, position) => (
                // Position, not name: rows carry no id, two can be identical,
                // pages only append, and a row holds no state of its own.
                <li key={position} tabIndex={-1}>
                  {vote.name === null ? (
                    <em>Verified voter</em>
                  ) : (
                    <b>{vote.name}</b>
                  )}
                  {" · "}
                  {choices
                    .filter((choice) => vote.choices.includes(choice.index))
                    .map((choice) => choice.label)
                    .join(", ")}
                </li>
              ))}
            </ul>
            <LoadMore
              more={more}
              hasMore={nextCursor !== null}
              itemCount={items.length}
              listRef={list}
              itemSelector="li"
              moreLabel="more votes"
              restartLabel={restart ? "Go to first page" : undefined}
              onLoadMore={restart ? restartFromFirstPage : loadMore}
            />
          </>
        )}
      </ViewState>
    </section>
  );
}
