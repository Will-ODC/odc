import type { PulseApi } from "../api/types.js";
import { useMyVotes } from "./use-my-votes.js";
import { useSession } from "./use-session.js";

export function usePageBanner(api: PulseApi) {
  const mine = useMyVotes(api);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: mine.clear,
    onForgotten: mine.clear,
  });
  return {
    session,
    progress,
    holdsVotes: mine.holdsVotes,
    ...(mine.voteRead ? { voteRead: mine.voteRead } : {}),
    onSignOut: signOut,
    onCancel: dismiss,
  };
}
