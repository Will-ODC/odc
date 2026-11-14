import { useCallback, useEffect, useState } from "react";
import type { PulseApi } from "../api/types.js";

/**
 * Whether the signed-in account owns the visible profile at `publicId`.
 *
 * `checked` is false until the first answer, so the page can wait before
 * choosing between the public list and the owner's own list. The owner view
 * is tied to the account seen by the check: `accountId` is sent with the
 * owner-only list, so an account switch is refused by the server. `recheck`
 * asks again (for example after that refusal); each answer has a new `check`
 * number, so a list read for the old answer is read again even when the
 * account turns out to be the same.
 */
export function useProfileOwner(api: PulseApi, publicId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    checked: boolean;
    check: number;
    owner: { publicId: string; accountId: string } | null;
  }>({ checked: false, check: 0, owner: null });
  useEffect(() => {
    let live = true;
    const settle = (owner: { publicId: string; accountId: string } | null) => {
      if (live)
        setState((old) => ({ checked: true, check: old.check + 1, owner }));
    };
    void (async () => {
      try {
        const voter = await api.me();
        const profile = voter ? await api.myProfile(voter.id) : null;
        settle(
          voter && profile?.visible === true
            ? { publicId: profile.publicId, accountId: voter.id }
            : null,
        );
      } catch {
        settle(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, attempt]);
  const recheck = useCallback(() => setAttempt((value) => value + 1), []);
  // Public ids are UUIDs; a link may carry them in either case.
  const owner =
    state.owner?.publicId.toLowerCase() === publicId.toLowerCase()
      ? state.owner
      : null;
  return {
    checked: state.checked,
    check: state.check,
    accountId: owner?.accountId,
    recheck,
  };
}
