import { useCallback, useEffect, useState } from "react";
import type { PulseApi, SuggestResult, Suggestion } from "../api/types.js";
import { ApiError } from "../api/types.js";

/**
 * Options people have added, and adding one.
 *
 * Adding is never refused for being a near-duplicate: the answer says whether
 * anyone had already said it, and the screen tells the person quietly. Refusing
 * would only teach people to phrase around the check.
 */
export type AddState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; result: SuggestResult }
  | { status: "failed"; message: string };

export interface Suggestions {
  /** Most-said first. Empty until they have loaded, which is not an error. */
  all: Suggestion[];
  add: AddState;
  submit: (text: string) => void;
  /** Back to the field, after the person has read what came of the last one. */
  reset: () => void;
}

export function useSuggestions(api: PulseApi, pollId: string): Suggestions {
  const [all, setAll] = useState<Suggestion[]>([]);
  const [add, setAdd] = useState<AddState>({ status: "idle" });

  useEffect(() => {
    let live = true;
    setAll([]);
    setAdd({ status: "idle" });
    api.suggestions(pollId).then(
      (loaded) => {
        if (live) setAll(loaded);
      },
      () => {
        // A list that will not load costs the person nothing they came for.
        // The vote is the point; these are extra.
      },
    );
    return () => {
      live = false;
    };
  }, [api, pollId]);

  const submit = useCallback(
    (text: string) => {
      setAdd({ status: "sending" });
      api.suggest(pollId, text).then(
        (result) => {
          setAdd({ status: "done", result });
          // The server has just told us what the list now holds for this entry,
          // so the list is updated from the answer rather than fetched again.
          setAll((current) => merge(current, result.suggestion));
        },
        (err: unknown) => setAdd({ status: "failed", message: reason(err) }),
      );
    },
    [api, pollId],
  );

  const reset = useCallback(() => setAdd({ status: "idle" }), []);

  return { all, add, submit, reset };
}

/** Replace the entry if it is already listed, otherwise add it; most-said first. */
function merge(current: Suggestion[], one: Suggestion): Suggestion[] {
  const without = current.filter((entry) => entry.id !== one.id);
  return [...without, one].sort((a, b) => b.count - a.count);
}

function reason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "We could not add that. Check your connection and try again.";
}
