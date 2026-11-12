import { useCallback, useEffect, useRef, useState } from "react";
import { ContributionsError } from "../api/contributions.js";
import type { ViewData } from "./view-data.js";

/**
 * Load a contribution view, and load it again when `load` changes.
 *
 * With `keepReady`, a reload caused by a new `load` (someone signing in from
 * another tab, say) keeps the page on screen until the answer arrives, rather
 * than swapping it for "Loading…". Swapping it would unmount whatever the
 * person had open on it and lose their scroll position. "Try again" after an
 * error still shows "Loading…", since there is nothing on screen to keep.
 */
export function useContributionRead<T>(
  load: () => Promise<T>,
  { keepReady = false }: { keepReady?: boolean } = {},
) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ViewData<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setData((current) =>
      keepReady && current.status === "ready" ? current : { status: "loading" },
    );
    load().then(
      (value) => {
        if (live) setData({ status: "ready", value });
      },
      (error) => {
        if (live)
          setData({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load this page. Please try again.",
            ...(error instanceof ContributionsError
              ? { statusCode: error.status }
              : {}),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [load, revision, keepReady]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, reload, setData };
}

/** Retains a request key across uncertain retries, rotating when the payload changes. */
export function useContributionSave<T>(
  save: (input: T, key: string) => Promise<unknown>,
  done: () => void,
) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    status?: number;
  }>();
  const [saved, setSaved] = useState(false);
  const sending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  async function submit(input: T) {
    if (sending.current) return;
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    sending.current = true;
    setPending(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await save(input, attempt.current.key);
      attempt.current = null;
      setSaved(true);
      done();
    } catch (reason) {
      setFailure({
        message:
          reason instanceof Error
            ? reason.message
            : "Could not save. Please try again.",
        ...(reason instanceof ContributionsError
          ? { status: reason.status }
          : {}),
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    /** A new object per failure, so an effect can react to each one. */
    failure,
    error: failure?.message,
    errorStatus: failure?.status,
    saved,
    submit,
  };
}
