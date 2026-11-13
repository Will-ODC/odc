import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  type MemberProfile,
  type ProfileRequest,
  type PulseApi,
} from "../api/types.js";
import { SIGNED_IN_KEY } from "../flow/sign-in-return.js";
import type { ViewData } from "./view-data.js";

export type OwnerProfileValue = MemberProfile | null;

/** One account's profile; the caller remounts this owner when accounts change. */
export function useOwnerProfile(
  api: PulseApi,
  active: boolean,
  ownerAccountId: string,
  onAccountChanged: () => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewData<OwnerProfileValue>>({
    status: "loading",
  });
  // Invalidate before any promise can settle after sign-out, expiry or unmount.
  // Expiry keeps the ready value (and draft), but cannot accept an old reply.
  const identity = useRef(0);
  const signedIn = useRef(active);
  useLayoutEffect(() => {
    signedIn.current = active;
    identity.current += 1;
    return () => {
      signedIn.current = false;
      identity.current += 1;
    };
  }, [api, active]);
  const status = state.status;
  // The server said another account is signed in: drop everything this owner
  // holds and let the page reload the session (it remounts for the new one).
  const accountChanged = useCallback(() => {
    signedIn.current = false;
    identity.current += 1;
    setState({ status: "loading" });
    onAccountChanged();
  }, [onAccountChanged]);
  // A 401 on the first read leaves "Sign in" on screen. Once the same account
  // is signed in again (this owner was not remounted), read it again.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && status === "empty")
      setState({ status: "loading" });
    wasActive.current = active;
  }, [active, status]);
  // The session may still report this account after the owner read got a
  // 401. Reauthentication then leaves `active` unchanged. Retry that empty
  // read on the same announcements as useSession, without replacing a draft.
  useEffect(() => {
    if (!active || status !== "empty") return;
    const ask = () => {
      if (document.visibilityState === "hidden") return;
      setState((current) =>
        current.status === "empty" ? { status: "loading" } : current,
      );
    };
    const announced = (event: StorageEvent) => {
      if (event.key === SIGNED_IN_KEY) ask();
    };
    window.addEventListener("focus", ask);
    window.addEventListener("storage", announced);
    document.addEventListener("visibilitychange", ask);
    return () => {
      window.removeEventListener("focus", ask);
      window.removeEventListener("storage", announced);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [active, status]);
  useEffect(() => {
    if (!active || status !== "loading") return;
    let live = true;
    const ticket = identity.current;
    api.myProfile(ownerAccountId).then(
      (profile) => {
        if (live && ticket === identity.current)
          setState({ status: "ready", value: profile });
      },
      (error: unknown) => {
        if (!live || ticket !== identity.current) return;
        // Read for another account than this editor's: never show it here.
        if (isAccountChanged(error)) {
          accountChanged();
          return;
        }
        setState(
          error instanceof ApiError && error.status === 401
            ? {
                status: "empty",
                message: "Sign in to create or change your public profile.",
              }
            : {
                status: "error",
                message:
                  "We couldn't load your profile. Check your connection and try again.",
              },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [api, attempt, active, status, ownerAccountId, accountChanged]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  const save = useCallback(
    async (request: Omit<ProfileRequest, "ownerAccountId">) => {
      if (!signedIn.current) return;
      const ticket = identity.current;
      try {
        const profile = await api.saveProfile({ ...request, ownerAccountId });
        if (ticket !== identity.current) return;
        setState({ status: "ready", value: profile });
        return profile;
      } catch (error) {
        if (ticket !== identity.current) return;
        if (isAccountChanged(error)) {
          accountChanged();
          return;
        }
        throw error;
      }
    },
    [api, ownerAccountId, accountChanged],
  );
  return { state, retry, save };
}

function isAccountChanged(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "account_changed"
  );
}
