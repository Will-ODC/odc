import { useRef } from "react";
import type { PollSummary } from "../api/types.js";
import { pathOf } from "../flow/route.js";
import type { ViewData } from "../hooks/view-data.js";
import { Button } from "./Button.js";
import { ViewState } from "./ViewState.js";
import "./SuggestedVotesRail.css";

export function SuggestedVotesRail({
  visible,
  data,
  onRetry,
  current,
  disabled = false,
  onOpen,
}: {
  visible: boolean;
  data: ViewData<readonly PollSummary[]>;
  onRetry: () => void;
  current?: string;
  disabled?: boolean;
  onOpen?: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  if (!visible) return null;

  return (
    <aside className="suggested-votes-rail">
      <nav aria-label="Suggested votes">
        <h2 ref={heading} tabIndex={-1}>
          Suggested votes
        </h2>
        <ViewState data={data} variant="compact">
          {(items) => (
            <ul>
              {items.map((poll) => (
                <li key={poll.id}>
                  <a
                    href={pathOf({ kind: "conversation", pollId: poll.id })}
                    aria-current={poll.id === current ? "page" : undefined}
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
          <Button
            variant="secondary"
            size="small"
            type="button"
            onClick={() => {
              heading.current?.focus();
              onRetry();
            }}
          >
            Try suggestions again
          </Button>
        ) : null}
      </nav>
    </aside>
  );
}
