import { useCallback, useMemo } from "react";
import type { PollPage, PollSummary, PulseApi } from "../api/types.js";
import { usePagedList } from "./use-paged-list.js";
import type { ViewData } from "./view-data.js";

const EMPTY = "No questions here yet. Try the starting questions or post one.";
const ERROR = "We couldn't load the questions. Try again.";
const MORE_ERROR = "We couldn't load more questions. Try again.";
const keyOf = (poll: PollSummary) => poll.id;

export function usePollList(api: PulseApi, community: string) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page =
        cursor === undefined
          ? await api.listPolls(community)
          : await api.listPolls(community, cursor);
      // Explore has always treated an empty first page as its empty view.
      return {
        items: page.polls,
        nextCursor:
          cursor === undefined && page.polls.length === 0
            ? null
            : page.nextCursor,
      };
    },
    [api, community],
  );
  const paged = usePagedList({
    fetchPage,
    keyOf,
    emptyMessage: EMPTY,
    errorMessage: ERROR,
    moreErrorMessage: MORE_ERROR,
  });
  const data = useMemo<ViewData<PollPage>>(
    () =>
      paged.data.status === "ready"
        ? {
            status: "ready",
            value: {
              polls: paged.data.value.items,
              nextCursor: paged.data.value.nextCursor,
            },
          }
        : paged.data,
    [paged.data],
  );
  return { ...paged, data };
}
