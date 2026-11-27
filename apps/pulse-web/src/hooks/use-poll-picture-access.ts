import { useCallback, useEffect, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { SIGNED_IN_KEY } from "../flow/sign-in-return.js";

/** The public poll and its attribution carry no management permission. */
export function usePollPictureAccess(
  api: PulseApi,
  pollId: string | undefined,
  accountId: string | null,
) {
  const [permission, setPermission] = useState<{
    api: PulseApi;
    pollId: string;
    accountId: string;
  } | null>(null);
  useEffect(() => {
    setPermission(null);
    if (!pollId || accountId === null) return;
    let live = true;
    void api.pollPictureAccess(pollId).then(
      (canManage) => {
        if (live && canManage === true)
          setPermission({ api, pollId, accountId });
      },
      () => {},
    );
    // Revoke this account's editor without changing the voting session.
    const checkAccount = (event: StorageEvent) => {
      if (event.key !== SIGNED_IN_KEY) return;
      void api.me().then(
        (me) => {
          if (!live || !me || me.id === accountId) return;
          live = false;
          setPermission(null);
        },
        () => {},
      );
    };
    window.addEventListener("storage", checkAccount);
    return () => {
      live = false;
      window.removeEventListener("storage", checkAccount);
    };
  }, [api, pollId, accountId]);
  const canManage =
    permission !== null &&
    permission.api === api &&
    permission.pollId === pollId &&
    permission.accountId === accountId;
  const revoke = useCallback(() => {
    setPermission((current) =>
      current?.api === api &&
      current.pollId === pollId &&
      current.accountId === accountId
        ? null
        : current,
    );
  }, [api, pollId, accountId]);
  return { canManage, revoke };
}
