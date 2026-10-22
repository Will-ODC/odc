import { useEffect, useRef, useState } from "react";
import { ApiError, type PollPage, type PulseApi } from "../api/types.js";
import type { ViewData } from "./view-data.js";

type More =
  { status: "idle" | "loading" } | { status: "error"; message: string };
const message = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : "We couldn't load the questions. Try again.";

export function usePollList(api: PulseApi, community: string) {
  const [data, setData] = useState<ViewData<PollPage>>({ status: "loading" });
  const [more, setMore] = useState<More>({ status: "idle" });
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    setData({ status: "loading" });
    setMore({ status: "idle" });
    api.listPolls(community).then(
      (page) => {
        if (generation.current === current)
          setData(
            page.polls.length
              ? { status: "ready", value: page }
              : {
                  status: "empty",
                  message:
                    "No questions here yet. Try the starting questions or post one.",
                },
          );
      },
      (err: unknown) => {
        if (generation.current === current)
          setData({ status: "error", message: message(err) });
      },
    );
    return () => {
      ++generation.current;
    };
  }, [api, community, attempt]);

  function loadMore() {
    if (busy.current || data.status !== "ready" || !data.value.nextCursor)
      return;
    busy.current = true;
    setMore({ status: "loading" });
    const current = generation.current;
    const previous = data.value;
    api.listPolls(community, previous.nextCursor!).then(
      (page) => {
        if (generation.current !== current) return;
        busy.current = false;
        if (page.nextCursor === previous.nextCursor) {
          setMore({
            status: "error",
            message: "We couldn't load more questions. Try again.",
          });
          return;
        }
        const rows = new Map(previous.polls.map((p) => [p.id, p]));
        page.polls.forEach((p) => rows.set(p.id, p));
        setData({
          status: "ready",
          value: { polls: [...rows.values()], nextCursor: page.nextCursor },
        });
        setMore({ status: "idle" });
      },
      (err: unknown) => {
        if (generation.current !== current) return;
        busy.current = false;
        setMore({ status: "error", message: message(err) });
      },
    );
  }
  return { data, more, loadMore, retry: () => retry((n) => n + 1) };
}
