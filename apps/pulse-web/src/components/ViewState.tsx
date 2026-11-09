import type { ReactNode } from "react";
import type { ViewData } from "../hooks/view-data.js";
import "./ViewState.css";

/**
 * Renders the three states that are not content, and hands the content state
 * to `children`. Every view goes through this, which is what stops each screen
 * inventing its own idea of what loading looks like.
 *
 * `children` is a function rather than a node so the value is only in scope
 * once it exists — a screen cannot read a poll that has not loaded.
 */
export function ViewState<T>({
  data,
  children,
  variant = "default",
  persistent = false,
  readyNote,
}: {
  data: ViewData<T>;
  children: (value: T) => ReactNode;
  variant?: "default" | "compact";
  /**
   * Keep the status region mounted once ready, so a later reload is read out
   * from a region that was already there; a newly inserted one often is not.
   * The region is empty while ready, but for `readyNote`.
   */
  persistent?: boolean;
  /** Read out, not drawn, while ready: for a reload that ended well. */
  readyNote?: string;
}) {
  const className = `viewstate${variant === "compact" ? " viewstate--compact" : ""}`;
  const ready = data.status === "ready";
  // One shape in every state, so a persistent region is the same node throughout.
  return (
    <>
      {ready ? children(data.value) : null}
      {ready && !persistent ? null : (
        <div className={className} role="status" aria-live="polite">
          {data.status === "ready" ? (
            readyNote ? (
              <p className="visually-hidden">{readyNote}</p>
            ) : null
          ) : data.status === "loading" ? (
            <>
              <div className="viewstate__pulse" aria-hidden="true" />
              <p>Loading…</p>
            </>
          ) : (
            <p>{data.message}</p>
          )}
        </div>
      )}
    </>
  );
}
