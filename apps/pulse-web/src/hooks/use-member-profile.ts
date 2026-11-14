import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type PublicMemberProfile,
  type PulseApi,
} from "../api/types.js";
import type { ViewData } from "./view-data.js";

export function useMemberProfile(api: PulseApi, publicId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewData<PublicMemberProfile>>({
    status: "loading",
  });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api.profile(publicId).then(
      (profile) => {
        if (live) setState({ status: "ready", value: profile });
      },
      (error: unknown) => {
        if (!live) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? {
                status: "empty",
                message:
                  "This profile is unavailable. Check the link and try again.",
              }
            : {
                status: "error",
                message:
                  "We couldn't load this profile. Check your connection and try again.",
              },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [api, publicId, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}
