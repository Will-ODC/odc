import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type MemberProfile,
  type ProfileRequest,
  type PulseApi,
} from "../api/types.js";
import type { ViewData } from "./view-data.js";

export type OwnerProfileValue = MemberProfile | null;

export function useOwnerProfile(api: PulseApi) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewData<OwnerProfileValue>>({
    status: "loading",
  });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api.myProfile().then(
      (profile) => {
        if (live) setState({ status: "ready", value: profile });
      },
      (error: unknown) => {
        if (!live) return;
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
  }, [api, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const save = useCallback(
    async (request: ProfileRequest) => {
      const profile = await api.saveProfile(request);
      setState({ status: "ready", value: profile });
      return profile;
    },
    [api],
  );
  return { state, retry, save };
}
