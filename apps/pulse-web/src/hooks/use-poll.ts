import { useEffect, useState } from "react";
import type { Poll, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import type { ViewData } from "./view-data.js";

/**
 * Load one poll.
 *
 * A poll the server does not have is `empty`, not `error`: nothing is broken,
 * there is simply nothing open to answer, and the person is owed that sentence
 * rather than a fault. Every other refusal is an error.
 */
export function usePoll(api: PulseApi, pollId: string): ViewData<Poll> {
  const [state, setState] = useState<ViewData<Poll>>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });

    api.poll(pollId).then(
      (poll) => {
        if (live) setState({ status: "ready", value: poll });
      },
      (err: unknown) => {
        if (!live) return;
        setState(failure(err));
      },
    );

    // A poll id that changes mid-flight must not be overwritten by the answer
    // to the old one.
    return () => {
      live = false;
    };
  }, [api, pollId]);

  return state;
}

function failure(err: unknown): ViewData<never> {
  if (err instanceof ApiError && err.status === 404) {
    return { status: "empty", message: "There is nothing to vote on yet." };
  }
  if (err instanceof ApiError) {
    return { status: "error", message: err.message };
  }
  return {
    status: "error",
    message:
      "We could not reach the ballot. Check your connection and try again.",
  };
}
