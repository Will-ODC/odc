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
