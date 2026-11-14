import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type MyVote,
  type MyVotesPage,
  type PulseApi,
} from "../api/types.js";
import {
  answeredList,
  mergedVotes,
  myVotesPlace,
  type LocalAnswer,
  type MyVotesPlace,
} from "../flow/answered.js";
import type { ViewData } from "./view-data.js";

type More =
  { status: "idle" | "loading" } | { status: "error"; message: string };

/** First read stays neutral; a retry keeps the error recovery controls. */
export type VoteRead =
  | { status: "loading"; retrying: boolean }
  | { status: "error"; message: string; onRetry: () => void };

export const MY_VOTES_EMPTY = "No votes saved in this browser yet.";
export const MY_VOTES_ERROR = "We couldn't load your votes. Try again.";
const message = (err: unknown) =>
  err instanceof ApiError ? err.message : MY_VOTES_ERROR;

/**
 * This browser's saved answers (#329), read from the server on every visit,
 * with Load more. A page may arrive short or even empty and still have more
 * after it (API.md), so "empty" means no entries *and* no next page.
 * `clear` empties the list at once, for sign-out and forgetting votes.
 */
export function useMyVotes(api: PulseApi) {
  const [data, setData] = useState<ViewData<MyVotesPage>>({
    status: "loading",
  });
  const [more, setMore] = useState<More>({ status: "idle" });
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    setData({ status: "loading" });
    setMore({ status: "idle" });
    api.myVotes().then(
      (page) => {
        if (generation.current === current) setData(asView(page));
      },
      (err: unknown) => {
        if (generation.current === current)
          setData({ status: "error", message: message(err) });
      },
    );
    return () => {
      ++generation.current;
    };
  }, [api, attempt]);

  function loadMore() {
    if (busy.current || data.status !== "ready" || !data.value.nextCursor)
      return;
    busy.current = true;
    setMore({ status: "loading" });
    const current = generation.current;
    const previous = data.value;
    api.myVotes(previous.nextCursor!).then(
      (page) => {
        if (generation.current !== current) return;
        busy.current = false;
        if (page.nextCursor === previous.nextCursor) {
          setMore({
            status: "error",
            message: "We couldn't load more of your votes. Try again.",
          });
          return;
        }
        const rows = new Map(previous.votes.map((vote) => [vote.pollId, vote]));
        page.votes.forEach((vote) => rows.set(vote.pollId, vote));
        setData(
          asView({ votes: [...rows.values()], nextCursor: page.nextCursor }),
        );
        setMore({ status: "idle" });
      },
      (err: unknown) => {
        if (generation.current !== current) return;
        busy.current = false;
        setMore({ status: "error", message: message(err) });
      },
    );
  }

  const clear = useCallback(() => {
    // Drops any read still in flight, so it cannot put the votes back.
    ++generation.current;
    busy.current = false;
    setMore({ status: "idle" });
    setData({ status: "empty", message: MY_VOTES_EMPTY });
  }, []);

  const retryRead = () => retry((n) => n + 1);
  const voteRead: VoteRead | undefined =
    data.status === "loading"
      ? { status: "loading", retrying: attempt > 0 }
      : data.status === "error"
        ? { status: "error", message: data.message, onRetry: retryRead }
        : undefined;

  return {
    data,
    more,
    loadMore,
    clear,
    // A cursor-only page still means this browser holds saved votes. Every
    // page derives its header from this same server-backed source (#487).
    holdsVotes: data.status === "ready",
    voteRead,
    retry: retryRead,
  };
}

interface Later {
  first: MyVotesPage | undefined;
  rows: MyVote[];
  cursor: string | null;
  /** The open question a read failed or stuck for, if any. */
  failedFor: string | null;
}

const startOf = (first: MyVotesPage | undefined): Later => ({
  first,
  rows: [],
  cursor: first?.nextCursor ?? null,
  failedFor: null,
});

/**
 * My votes rows after `first`, read only so a question page can find an older
 * saved answer's place and the row below it (#528). Nothing draws them: the
 * rail keeps its first page and See all my votes. While `wanted`, it reads
 * one page at a time, and starts over when `first` is read again. `more` is
 * whether a cursor is left. A failed or stuck read stops it for `question`,
 * the open question (`failed`); opening another question tries once more, so
 * one blip does not last the visit and a page that always fails is asked
 * for once per question, never in a loop.
 */
export function useLaterVotes(
  api: PulseApi,
  first: MyVotesPage | undefined,
  wanted: boolean,
  question: string,
) {
  const [later, setLater] = useState<Later>(() => startOf(first));
  let current = later;
  if (later.first !== first) {
    current = startOf(first);
    setLater(current);
  }
  const { cursor } = current;
  const failed = current.failedFor === question;
  // The read in flight, so a re-render never asks for the same page twice.
  const reading = useRef<{ first: MyVotesPage; cursor: string } | null>(null);
  // The question open when a read settles, which the failure is recorded
  // against: a read started for one question can end on another that was
  // waiting for the same page.
  const open = useRef(question);
  open.current = question;
  useEffect(() => {
    if (!wanted || !first || !cursor || failed) return;
    const asked = reading.current;
    if (asked && asked.first === first && asked.cursor === cursor) return;
    reading.current = { first, cursor };
    const settle = (next: (old: Later) => Later) => {
      if (reading.current?.first === first) reading.current = null;
      setLater((old) =>
        old.first === first && old.cursor === cursor ? next(old) : old,
      );
    };
    const stop = (old: Later) => ({ ...old, failedFor: open.current });
    api.myVotes(cursor).then(
      (page) =>
        settle((old) =>
          page.nextCursor === cursor
            ? stop(old)
            : {
                ...old,
                rows: [...old.rows, ...page.votes],
                cursor: page.nextCursor,
                failedFor: null,
              },
        ),
      () => settle(stop),
    );
  }, [api, first, cursor, failed, wanted]);
  return { rows: current.rows, more: current.cursor !== null, failed };
}

/**
 * Where the open question `at` stands in My votes, for its Previous and Next
 * (#528); see `myVotesPlace`. `first` is the rail's first page (undefined
 * until read), `answers` and `recent` this page's answers, and `round` counts
 * forgettings, which start the list of questions answered here over.
 */
export function useMyVotesPlace({
  api,
  first,
  firstLoading,
  answers,
  recent,
  at,
  round,
}: {
  api: PulseApi;
  first: MyVotesPage | undefined;
  firstLoading: boolean;
  answers: readonly LocalAnswer[];
  recent: readonly string[];
  at: string;
  round: number;
}): MyVotesPlace {
  // Questions answered here or restored, as of when the open one was
  // opened: once left and opened again, a first answer is in My votes too.
  const [listedFor, setListedFor] = useState({
    at,
    round,
    ids: [] as string[],
  });
  // A saved answer read back for this question when it was opened: in
  // `answers` without having been cast here.
  const restoredHere =
    answers.some((one) => one.poll.id === at) && !recent.includes(at);
  if (listedFor.round !== round) setListedFor({ at, round, ids: [] });
  else if (listedFor.at !== at)
    setListedFor({
      at,
      round,
      ids: [
        ...new Set([...listedFor.ids, ...answers.map((one) => one.poll.id)]),
      ],
    });
  else if (restoredHere && !listedFor.ids.includes(at))
    setListedFor({ at, round, ids: [...listedFor.ids, at] });
  const serverVotes = first?.votes ?? [];
  // Later pages are read only while a saved answer's row, or the row below
  // the last one read, may be on one. An unanswered question reads nothing.
  const [wanted, setWanted] = useState(false);
  const later = useLaterVotes(api, first, wanted, at);
  const loaded = mergedVotes(serverVotes, later.rows);
  // Saved when opened: its row has been read from any page (so a question
  // opened by Next from a later page keeps its pager even when its ballot or
  // results could not be read back), its ballot was read back, or it was
  // answered here and opened again.
  const listed =
    loaded.some((vote) => vote.pollId === at) ||
    restoredHere ||
    (listedFor.round === round &&
      listedFor.at === at &&
      listedFor.ids.includes(at));
  const found = myVotesPlace({
    ordered: answeredList(loaded, answers, recent),
    loaded,
    recent,
    current: at,
    listed,
    more: firstLoading || later.more,
  });
  // A page that could not be read: the answer-selected Next, as before.
  const place: MyVotesPlace =
    found.kind === "finding" && later.failed ? { kind: "none" } : found;
  const looking = place.kind === "finding" && first !== undefined;
  if (looking !== wanted) setWanted(looking);
  return place;
}

function asView(page: MyVotesPage): ViewData<MyVotesPage> {
  return page.votes.length === 0 && page.nextCursor === null
    ? { status: "empty", message: MY_VOTES_EMPTY }
    : { status: "ready", value: page };
}

/**
 * Votes that follow who is signed in: `cleared()` empties them when a person
 * leaves (pass it as `onSignedOut`), and the next account to sign in, the same
 * person recovering an expired session included, gets them read again.
 */
export function useVotesFollowSession(mine: {
  clear: () => void;
  retry: () => void;
}) {
  const emptied = useRef(false);
  const { clear } = mine;
  const cleared = useCallback(() => {
    emptied.current = true;
    clear();
  }, [clear]);
  const signedInAs = (accountId: string | null) => {
    if (accountId !== null && emptied.current) {
      emptied.current = false;
      mine.retry();
    }
  };
  return { cleared, signedInAs };
}
