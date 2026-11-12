import { useEffect, useRef, useState } from "react";
import type { MyVote, MyVotesPage, PollPage, PulseApi } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import { usePollList } from "../hooks/use-poll-list.js";
import { useWide } from "../hooks/use-wide.js";
import type { ViewData } from "../hooks/view-data.js";
import { ViewState } from "./ViewState.js";
import "./SuggestedVotesRail.css";

const SIDEBAR_WIDTH = "(min-width: 1100px)";

export function SuggestedVotesRail({
  api,
  source,
  history,
  retryHistory,
  justAnswered = [],
  current,
  disabled = false,
  onOpen,
}: {
  api: PulseApi;
  history: ViewData<MyVotesPage>;
  retryHistory: () => void;
  justAnswered?: readonly MyVote[];
  source?: { data: ViewData<PollPage>; retry: () => void };
  current?: string;
  disabled?: boolean;
  onOpen?: (id: string) => void;
}) {
  const visible = useWide(SIDEBAR_WIDTH);
  const fetched = usePollList(api, "pulse-general", visible && !source);
  const { data, retry } = source ?? fetched;
  const heading = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<{
    polls: PollPage;
    history: MyVotesPage;
    attempt: number;
    unanswered: ReadonlySet<string> | null;
  }>();
  const pollPage = data.status === "ready" ? data.value : null;
  const historyPage = history.status === "ready" ? history.value : null;
  const partialHistory = historyPage?.nextCursor != null;

  useEffect(() => {
    if (!visible || !pollPage || !historyPage || !partialHistory) return;
    let live = true;
    const known = new Set(historyPage.votes.map((vote) => vote.pollId));
    // Check only candidates from the newest poll page if vote history has
    // older pages. The ballot itself is never used to order suggestions.
    const candidates = pollPage.polls
      .slice(0, 20)
      .filter((poll) => poll.open && !known.has(poll.id));
    void Promise.all(
      candidates.map(async (poll) =>
        (await api.myBallot(poll.id)) === null ? poll.id : null,
      ),
    ).then(
      (ids) => {
        if (live)
          setChecked({
            polls: pollPage,
            history: historyPage,
            attempt,
            unanswered: new Set(ids.filter((id) => id !== null)),
          });
      },
      () => {
        if (live)
          setChecked({
            polls: pollPage,
            history: historyPage,
            attempt,
            unanswered: null,
          });
      },
    );
    return () => {
      live = false;
    };
  }, [api, attempt, historyPage, partialHistory, pollPage, visible]);

  if (!visible) return null;

  const answered = new Set([
    ...(historyPage?.votes ?? []).map((vote) => vote.pollId),
    ...justAnswered.map((vote) => vote.pollId),
  ]);
  const verification =
    checked &&
    checked.polls === pollPage &&
    checked.history === historyPage &&
    checked.attempt === attempt
      ? checked
      : undefined;
  const polls = (pollPage?.polls.slice(0, 20) ?? [])
    .filter(
      (poll) =>
        poll.open &&
        poll.id !== current &&
        !answered.has(poll.id) &&
        (!partialHistory || verification?.unanswered?.has(poll.id)),
    )
    .slice(0, 5);
  const failed =
    data.status === "error" ||
    history.status === "error" ||
    (partialHistory && verification?.unanswered === null);
  const loading =
    data.status === "loading" ||
    history.status === "loading" ||
    (pollPage !== null && partialHistory && !verification);
  const view: ViewData<typeof polls> = failed
    ? { status: "error", message: "Could not load suggested votes." }
    : loading
      ? { status: "loading" }
      : polls.length
        ? { status: "ready", value: polls }
        : {
            status: "empty",
            message: "No unanswered open questions to suggest.",
          };

  return (
    <aside className="suggested-votes-rail">
      <nav aria-label="Suggested votes">
        <h2 ref={heading} tabIndex={-1}>
          Suggested votes
        </h2>
        <ViewState data={view} variant="compact">
          {(items) => (
            <ul>
              {items.map((poll) => (
                <li key={poll.id}>
                  <a
                    href={pathOf({ kind: "conversation", pollId: poll.id })}
                    aria-disabled={disabled || undefined}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      if (disabled || onOpen) event.preventDefault();
                      if (!disabled) onOpen?.(poll.id);
                    }}
                  >
                    {poll.question}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </ViewState>
        {failed ? (
          <button
            className="button"
            type="button"
            onClick={() => {
              heading.current?.focus();
              if (data.status === "error") retry();
              if (history.status === "error") retryHistory();
              setAttempt((value) => value + 1);
            }}
          >
            Try suggestions again
          </button>
        ) : null}
      </nav>
    </aside>
  );
}
