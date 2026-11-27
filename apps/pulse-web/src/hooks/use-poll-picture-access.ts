import { useCallback, useEffect, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { SIGNED_IN_KEY } from "../flow/sign-in-return.js";

/** The public poll and its attribution carry no management permission. */
export function usePollPictureAccess(
  api: PulseApi,
  pollId: string | undefined,
  sessionAccountId: string | null,
) {
  const [permission, setPermission] = useState<{
    api: PulseApi;
    pollId: string;
    sessionAccountId: string;
    ownerId: string;
  } | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(false);
  useEffect(() => {
    setPermission(null);
    setCheckingAccount(false);
    if (!pollId || sessionAccountId === null) return;
    let latestRequest = 0;
    let retryOnFocus = false;

    // The picture editor follows the current account independently of voting.
    const refresh = async (readCurrentAccount: boolean) => {
      const request = ++latestRequest;
      retryOnFocus = false;
      if (readCurrentAccount) setCheckingAccount(true);
      try {
        const ownerId = readCurrentAccount
          ? (await api.me())?.id
          : sessionAccountId;
        if (request !== latestRequest) return;
        if (!ownerId) {
          retryOnFocus = true;
          return;
        }
        setPermission((current) =>
          current?.ownerId === ownerId ? current : null,
        );
        const canManage = await api.pollPictureAccess(pollId);
        if (request !== latestRequest) return;
        setCheckingAccount(false);
        setPermission(
          canManage === true
            ? { api, pollId, sessionAccountId, ownerId }
            : null,
        );
      } catch {
        if (request === latestRequest) retryOnFocus = true;
      }
    };

    void refresh(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIGNED_IN_KEY) void refresh(true);
    };
    const onFocus = () => {
      if (retryOnFocus) void refresh(true);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      latestRequest += 1;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [api, pollId, sessionAccountId]);

  const ownerId =
    permission?.api === api &&
    permission.pollId === pollId &&
    permission.sessionAccountId === sessionAccountId
      ? permission.ownerId
      : null;
  const revoke = useCallback(() => {
    setPermission((current) =>
      current?.api === api &&
      current.pollId === pollId &&
      current.sessionAccountId === sessionAccountId &&
      current.ownerId === ownerId
        ? null
        : current,
    );
  }, [api, pollId, sessionAccountId, ownerId]);
  return { ownerId, checkingAccount, revoke };
}
