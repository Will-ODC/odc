import { useEffect, useMemo, useState } from "react";
import type { MyVote, PulseApi, VotePrivacy } from "../api/types.js";

/** My votes rows omit the poll's privacy. Read it without holding up the list. */
export function usePublicVoteTags(
  api: PulseApi,
  votes: readonly MyVote[] | undefined,
): readonly MyVote[] | undefined {
  const cache = useMemo(() => new Map<string, Promise<VotePrivacy>>(), [api]);
  const [publicIds, setPublicIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!votes) return;
    let live = true;
    for (const vote of votes) {
      if (vote.votePrivacy) continue;
      const { pollId } = vote;
      let privacy = cache.get(pollId);
      if (!privacy) {
        privacy = api
          .poll(pollId)
          .then((poll) => poll.votePrivacy ?? "anonymous");
        cache.set(pollId, privacy);
      }
      void privacy.then(
        (value) => {
          if (live && value === "public")
            setPublicIds((old) =>
              old.has(pollId) ? old : new Set(old).add(pollId),
            );
        },
        () => {
          cache.delete(pollId);
        },
      );
    }
    return () => {
      live = false;
    };
  }, [api, cache, votes]);

  return useMemo(
    () =>
      votes?.map((vote) =>
        !vote.votePrivacy && publicIds.has(vote.pollId)
          ? { ...vote, votePrivacy: "public" }
          : vote,
      ),
    [votes, publicIds],
  );
}
