import type { MouseEvent, Ref } from "react";
import type { MyVote } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import "../screens/Browse.css";
import "./AnsweredList.css";

/**
 * Your saved answers as one list (#484), drawn the same on the My votes page
 * and in the Answered rail beside a question: the question, your answer, and
 * whether it can still change. Each row is a link to the question.
 *
 * `onOpen`, when given, opens a question in place instead of loading the
 * page again (the rail, where the conversation is already on screen).
 * `disabled` marks the rows unavailable while the page cannot leave the
 * question on screen (an answer is being sent); a plain click does nothing.
 */
export function AnsweredList({
  votes,
  current,
  compact = false,
  disabled = false,
  onOpen,
  listRef,
}: {
  votes: readonly MyVote[];
  /** The question on screen, marked as the current one. */
  current?: string;
  compact?: boolean;
  disabled?: boolean;
  onOpen?: (pollId: string) => void;
  listRef?: Ref<HTMLUListElement>;
}) {
  return (
    <ul
      ref={listRef}
      className={`browse__list answered${compact ? " answered--compact" : ""}`}
    >
      {votes.map((vote) => (
        <li key={vote.pollId}>
          <a
            href={pathOf({ kind: "conversation", pollId: vote.pollId })}
            aria-current={current === vote.pollId ? "page" : undefined}
            aria-disabled={disabled ? "true" : undefined}
            {...(onOpen
              ? {
                  onClick: (event: MouseEvent<HTMLAnchorElement>) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    if (!disabled) onOpen(vote.pollId);
                  },
                }
              : {})}
          >
            {vote.question}
          </a>
          <span className="answered__detail">
            {vote.choices.length
              ? `Your answer: ${vote.choices.join(", ")}`
              : "Your answer couldn't be shown."}
          </span>
          <span className="answered__detail">
            {vote.open
              ? "Open · You can change your answer"
              : "Closed · View results"}
          </span>
        </li>
      ))}
    </ul>
  );
}
