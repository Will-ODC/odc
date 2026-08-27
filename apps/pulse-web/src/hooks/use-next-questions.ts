import { useEffect, useState } from "react";
import type { PulseApi } from "../api/types.js";

/** Separates ids in the dependency key. A poll id never contains a space. */
const SEPARATOR = " ";

/**
 * The question each choice opens, by choice position - for the preview a
 * ballot shows beside each answer.
 *
 * A preview and nothing more: a poll that cannot be read is left out rather
 * than reported, because failing to show what comes next is no reason to
 * refuse someone the vote in front of them.
 *
 * Takes the edges already joined into one string. An array would be a new
 * array on every render and would re-run this on every render with it; the
 * string is the same value whenever the graph is the same shape.
 */
export function useNextQuestions(
  api: PulseApi,
  edges: string,
): (string | undefined)[] {
  const [questions, setQuestions] = useState<(string | undefined)[]>([]);

  useEffect(() => {
    let live = true;
    const ids = edges === "" ? [] : edges.split(SEPARATOR);
    setQuestions(ids.map(() => undefined));

    Promise.all(
      ids.map((id) =>
        id === ""
          ? Promise.resolve(undefined)
          : api.poll(id).then(
              (next) => next.question,
              () => undefined,
            ),
      ),
    ).then((loaded) => {
      if (live) setQuestions(loaded);
    });

    return () => {
      live = false;
    };
  }, [api, edges]);

  return questions;
}

/** The dependency key for a poll's onward links. `null` becomes an empty id. */
export function edgesOf(next: readonly (string | null)[]): string {
  return next.map((id) => id ?? "").join(SEPARATOR);
}
