import type { MyVote, Poll } from "../api/types.js";

/** An answer this page knows about: the question and the positions chosen. */
export interface LocalAnswer {
  poll: Poll;
  ballot: readonly number[];
}

/**
 * The Answered list (#484): the server's saved answers, kept in step with
 * what was answered on this page since they were read.
 *
 * The server lists the newest cast first and moves a changed answer to the
 * top (API.md, `GET /api/my-votes`), so this does the same: an answer the
 * server does not have yet, or has with a different ballot, goes on top,
 * newest first. One it already has with the same ballot (a saved answer
 * shown again, or fresh results for it) keeps the server's place.
 */
export function answeredList(
  saved: readonly MyVote[],
  local: readonly LocalAnswer[],
  now: number = Date.now(),
): MyVote[] {
  const known = new Map(saved.map((vote) => [vote.pollId, vote]));
  const moved: MyVote[] = [];
  for (const answer of local) {
    const vote = asVote(answer, now);
    const before = known.get(vote.pollId);
    if (before && sameBallot(before.ballot, vote.ballot)) continue;
    moved.unshift(vote);
  }
  const top = new Set(moved.map((vote) => vote.pollId));
  return [...moved, ...saved.filter((vote) => !top.has(vote.pollId))];
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

function sameBallot(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((index, at) => index === b[at]);
}
