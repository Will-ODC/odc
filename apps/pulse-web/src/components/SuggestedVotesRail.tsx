import { useRef } from "react";
import type { PollPage, PulseApi } from "../api/types.js";
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
  current,
  disabled = false,
  onOpen,
}: {
  api: PulseApi;
  source?: { data: ViewData<PollPage>; retry: () => void };
  current?: string;
  disabled?: boolean;
  onOpen?: (id: string) => void;
}) {
  const visible = useWide(SIDEBAR_WIDTH);
  const fetched = usePollList(api, "pulse-general", visible && !source);
  const { data, retry } = source ?? fetched;
  const heading = useRef<HTMLHeadingElement>(null);
  if (!visible) return null;

  const polls =
    data.status === "ready"
      ? data.value.polls
          .filter((poll) => poll.open && poll.id !== current)
          .slice(0, 5)
      : [];
  const view: ViewData<typeof polls> =
    data.status === "loading"
      ? data
      : data.status === "error"
        ? { status: "error", message: "Could not load suggested votes." }
        : polls.length
          ? { status: "ready", value: polls }
          : { status: "empty", message: "No open questions to suggest." };

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
        {data.status === "error" ? (
          <button
            className="button"
            type="button"
            onClick={() => {
              heading.current?.focus();
              retry();
            }}
          >
            Try suggestions again
          </button>
        ) : null}
      </nav>
    </aside>
  );
}
