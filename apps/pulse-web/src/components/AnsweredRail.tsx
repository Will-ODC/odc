import { useRef, type ComponentProps } from "react";
import { AnsweredList } from "./AnsweredList.js";
import { ViewState } from "./ViewState.js";
import { Button } from "./Button.js";
import type { ViewData } from "../hooks/view-data.js";
import { pathOf } from "../flow/route.js";
import "./AnsweredRail.css";

const RAIL_ERROR = "We couldn't load your votes.";
const RAIL_PARTIAL_ERROR = "We couldn't load all your votes.";
const RAIL_RELOADED = "Your votes are loaded.";

type Rows = ComponentProps<typeof AnsweredList>;

/** Shared saved-answer navigation; the screen owns its data and retries. */
export function AnsweredRail({
  data,
  votes,
  current,
  disabled = false,
  onOpen,
  onRetry,
  railRetried = false,
  className = "",
}: {
  data: ViewData<{ nextCursor: string | null }>;
  votes: Rows["votes"];
  current?: string;
  disabled?: boolean;
  onOpen?: Rows["onOpen"];
  onRetry: () => void;
  railRetried?: boolean;
  className?: string;
}) {
  const railHeading = useRef<HTMLAnchorElement>(null);
  // One status region for the rail, mounted throughout, so each change is read
  // out: Loading… while the list is read (with answers already listed too),
  // then an error, the empty message, or nothing to show.
  const railState: ViewData<null> =
    data.status === "error"
      ? {
          status: "error",
          message: votes.length > 0 ? RAIL_PARTIAL_ERROR : RAIL_ERROR,
        }
      : data.status === "loading"
        ? { status: "loading" }
        : data.status === "empty" && votes.length === 0
          ? { status: "empty", message: data.message }
          : { status: "ready", value: null };
  return (
    <aside className={["answered-rail", className].filter(Boolean).join(" ")}>
      <nav aria-label="My votes">
        <h2>
          <a ref={railHeading} href={pathOf({ kind: "myVotes" })}>
            My votes
          </a>
        </h2>
        {votes.length > 0 ? (
          <AnsweredList
            votes={votes}
            {...(current ? { current } : {})}
            compact
            disabled={disabled}
            {...(onOpen ? { onOpen } : {})}
          />
        ) : null}
        <ViewState
          data={railState}
          variant="compact"
          persistent
          {...(railRetried ? { readyNote: RAIL_RELOADED } : {})}
        >
          {() => null}
        </ViewState>
        {data.status === "error" ? (
          <Button
            variant="secondary"
            size="small"
            type="button"
            onClick={() => {
              // The button goes while the list is read again; focus stays in
              // the rail rather than falling to the page.
              railHeading.current?.focus();
              onRetry();
            }}
          >
            Try again
          </Button>
        ) : null}
        {data.status === "ready" && data.value.nextCursor ? (
          <p>
            <a href={pathOf({ kind: "myVotes" })}>See all my votes</a>
          </p>
        ) : null}
      </nav>
    </aside>
  );
}
