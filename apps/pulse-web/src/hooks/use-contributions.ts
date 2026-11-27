import { useCallback, useEffect, useRef, useState } from "react";
import { ContributionsError } from "../api/contributions.js";
import type { ViewData } from "./view-data.js";

/**
 * Load a contribution view, and load it again when `load` changes.
 *
 * With `keepReady`, a reload caused by a new `load` (someone signing in from
 * another tab, say) keeps the page on screen until the answer arrives, rather
 * than swapping it for "Loading…". Swapping it would unmount whatever the
 * person had open on it, with anything they had typed, and lose their scroll
 * position. If that background reload fails, the page stays as it was too:
 * the failure is no reason to throw away a draft. `refreshError` says so,
 * and `reload` tries again without hiding the page. "Try again" after an
 * error with nothing on screen still shows "Loading…".
 *
 * `replace` installs a newer value the page got from a write (a successful
 * participation, say). A read that started before it carries an older
 * snapshot, so its answer is dropped and the view is read again. A write's
 * updater can likewise decline a superseded snapshot to trigger a fresh read.
 */
export function useContributionRead<T>(
  load: () => Promise<T>,
  { keepReady = false }: { keepReady?: boolean } = {},
) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ViewData<T>>({ status: "loading" });
  // Bumped to read again after a stale answer: still a background read.
  const [refresh, setRefresh] = useState(0);
  const [refreshError, setRefreshError] = useState<string>();
  const writes = useRef(0);
  // Update immediately so a second reply in the same render batch sees it.
  const shown = useRef(data);
  const show = useCallback((value: ViewData<T>) => {
    shown.current = value;
    setData(value);
  }, []);
  useEffect(() => {
    let live = true;
    const writesAtStart = writes.current;
    if (!keepReady || shown.current.status !== "ready")
      show({ status: "loading" });
    load().then(
      (value) => {
        if (!live) return;
        if (writes.current !== writesAtStart) {
          setRefresh((count) => count + 1);
          return;
        }
        setRefreshError(undefined);
        show({ status: "ready", value });
      },
      (error) => {
        if (!live) return;
        const failure: ViewData<T> = {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load this page. Please try again.",
          ...(error instanceof ContributionsError
            ? { statusCode: error.status }
            : {}),
        };
        // Something is on screen: keep it, and say the update failed.
        if (keepReady && shown.current.status === "ready")
          setRefreshError(failure.message);
        else show(failure);
      },
    );
    return () => {
      live = false;
    };
  }, [load, revision, refresh, keepReady, show]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const replace = useCallback(
    (update: (value: T) => T | undefined) => {
      const current = shown.current;
      if (current.status !== "ready") return;
      const value = update(current.value);
      writes.current += 1;
      if (value === undefined) {
        reload();
        return;
      }
      show({ status: "ready", value });
    },
    [reload, show],
  );
  return { data, reload, replace, refreshError };
}

export { useSave as useContributionSave } from "./use-save.js";
