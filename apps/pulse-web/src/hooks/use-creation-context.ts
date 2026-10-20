import { useCallback, useEffect, useState } from "react";
import type { CreationContext, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

/**
 * What the posting form needs before it can be shown (ADR-0037): where the
 * question will be posted, and whether this account has made the purpose
 * promise yet.
 *
 * Signed out is its own answer, not an error: the screen offers the way in.
 */
export type CreationState = ViewData<CreationContext> | { status: "signedOut" };

export function useCreationContext(api: PulseApi): {
  state: CreationState;
  retry: () => void;
  /** The server said a promise is needed after all; show it. */
  needPromise: () => void;
  /** The server said this session has ended. */
  signedOut: () => void;
} {
  const [state, setState] = useState<CreationState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api.creationContext().then(
      (context) => {
        if (live) setState({ status: "ready", value: context });
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ status: "signedOut" });
          return;
        }
        setState({
          status: "error",
          message:
            err instanceof ApiError
              ? err.message
              : "We could not reach pulse. Check your connection and try again.",
        });
      },
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const needPromise = useCallback(
    () =>
      setState((old) =>
        old.status === "ready"
          ? { ...old, value: { ...old.value, purposeAcknowledged: false } }
          : old,
      ),
    [],
  );
  const signedOut = useCallback(() => setState({ status: "signedOut" }), []);
  return { state, retry, needPromise, signedOut };
}
