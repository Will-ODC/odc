import { useCallback } from "react";
import type { PulseApi, Results } from "../api/types.js";
import { usePagedList } from "./use-paged-list.js";

export function usePublicVotes(api: PulseApi, results: Results | undefined) {
  const fetchPage = useCallback(
    (cursor?: string) => {
      if (!results)
        return Promise.reject(new Error("No poll results to show."));
      return api.publicVotes(results.pollId, cursor);
    },
    [api, results],
  );
  return usePagedList({
    enabled: results?.votePrivacy === "public",
    fetchPage,
    emptyMessage: "No public votes yet. Check back for answers.",
    errorMessage: "We couldn't load the public votes. Try again.",
    moreErrorMessage: "We couldn't load more public votes. Try again.",
  });
}
