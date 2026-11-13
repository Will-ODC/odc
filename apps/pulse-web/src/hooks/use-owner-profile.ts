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
  useEffect(() => {
    if (!active || status !== "loading") return;
    let live = true;
    const ticket = identity.current;
    api.myProfile().then(
      (profile) => {
        if (live && ticket === identity.current)
          setState({ status: "ready", value: profile });
      },
      (error: unknown) => {
        if (!live || ticket !== identity.current) return;
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
  }, [api, attempt, active, status]);
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
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === "account_changed"
        ) {
          signedIn.current = false;
          identity.current += 1;
          setState({ status: "loading" });
          onAccountChanged();
          return;
        }
        throw error;
      }
    },
    [api, ownerAccountId, onAccountChanged],
  );
  return { state, retry, save };
}
