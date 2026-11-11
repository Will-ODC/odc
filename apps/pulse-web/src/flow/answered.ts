import type { MyVote, Poll } from "../api/types.js";

/** An answer this page knows about: the question and the positions chosen. */
export interface LocalAnswer {
  poll: Poll;
  ballot: readonly number[];
}

/**
 * Where the open question stands in My votes, for Previous and Next (#528).
 *
 * - `none`: not a saved answer when it was opened. The answer-selected Next
 *   (#502) stays, and there is no Previous.
 * - `finding`: a saved answer whose row, or the row below it, is on a later
 *   page not read yet. Neither kind of Next is offered meanwhile.
 * - `found`: the rows above and below it, `null` at either end.
 */
export type MyVotesPlace =
  | { kind: "none" }
  | { kind: "finding" }
  | { kind: "found"; previous: MyVote | null; next: MyVote | null };

/**
 * The open question's place in `ordered`, the newest-first Answered list
 * built from every My votes row read so far (`loaded`) and this page's
 * answers (`recent`, cast or changed here, sit at the top).
 *
 * `listed` says the question was a saved answer when it was opened: its row
 * was read, its saved ballot was read back, or it was answered on this page
 * and opened again later. A first answer keeps its answer-selected Next.
 * `more` says rows after `loaded` may exist (a cursor, or a list still being
 * read). A row the server has not listed yet is not placed: a restored answer
 * is only appended after the loaded rows, which is not its place, so it is
 * neither found itself nor offered as another row's neighbour.
 */
export function myVotesPlace({
  ordered,
  loaded,
  recent,
  current,
  listed,
  more,
}: {
  ordered: readonly MyVote[];
  loaded: readonly MyVote[];
  recent: readonly string[];
  current: string;
  listed: boolean;
  more: boolean;
}): MyVotesPlace {
  if (!listed) return { kind: "none" };
  // Only rows in their real place: read from the server, or moved to the top
  // here. A restored row appended after them is nobody's neighbour.
  const loadedIds = new Set(loaded.map((vote) => vote.pollId));
  const placed = ordered.filter(
    (vote) => recent.includes(vote.pollId) || loadedIds.has(vote.pollId),
  );
  const index = placed.findIndex((vote) => vote.pollId === current);
  if (index < 0) return more ? { kind: "finding" } : { kind: "none" };
  if (index === placed.length - 1 && more) return { kind: "finding" };
  return {
    kind: "found",
    previous: placed[index - 1] ?? null,
    next: placed[index + 1] ?? null,
  };
}

/** My votes rows from several pages, each question once, in first-seen order. */
export function mergedVotes(
  first: readonly MyVote[],
  later: readonly MyVote[],
): MyVote[] {
  if (later.length === 0) return [...first];
  const rows = new Map(first.map((vote) => [vote.pollId, vote]));
  later.forEach((vote) => rows.set(vote.pollId, vote));
  return [...rows.values()];
}

/**
 * The Answered list (#484): the server's saved answers, kept in step with
 * what was answered on this page since they were read.
 *
 * The server lists the newest cast first and moves a changed answer to the
 * top (API.md, `GET /api/my-votes`), so `recent` records only successful
 * casts and changes on this page, in the order they happened. Restoring an
 * older answer is not a cast: it keeps the server's place, or is appended
 * after the loaded server rows when that row has not been loaded yet.
 */
export function answeredList(
  saved: readonly MyVote[],
  local: readonly LocalAnswer[],
  recent: readonly string[],
  now: number = Date.now(),
): MyVote[] {
  const answers = new Map(local.map((answer) => [answer.poll.id, answer]));
  const promotedIds: string[] = [];
  const promoted = new Set<string>();
  for (let at = recent.length - 1; at >= 0; at -= 1) {
    const id = recent[at];
    if (id !== undefined && answers.has(id) && !promoted.has(id)) {
      promoted.add(id);
      promotedIds.push(id);
    }
  }
  const savedIds = new Set(saved.map((vote) => vote.pollId));
  const restored = local.filter(
    (answer) => !promoted.has(answer.poll.id) && !savedIds.has(answer.poll.id),
  );
  return [
    ...promotedIds.map((id) => asVote(answers.get(id)!, now)),
    ...saved
      .filter((vote) => !promoted.has(vote.pollId))
      .map((vote) => {
        const localAnswer = answers.get(vote.pollId);
        return localAnswer
          ? { ...asVote(localAnswer, now), castAt: vote.castAt }
          : vote;
      }),
    ...restored.map((answer) => asVote(answer, now)),
  ];
}

function asVote({ poll, ballot }: LocalAnswer, now: number): MyVote {
  const positions = [...ballot].sort((a, b) => a - b);
  return {
    pollId: poll.id,
    question: poll.question,
    choices: positions
      .map((index) => poll.choices[index])
      .filter((label): label is string => label !== undefined),
    ballot: positions,
    castAt: new Date(now).toISOString(),
    closesAt: poll.closesAt,
    open:
      poll.open && (poll.closesAt === null || Date.parse(poll.closesAt) > now),
  };
}
