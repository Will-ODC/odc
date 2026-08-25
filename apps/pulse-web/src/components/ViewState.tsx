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
}: {
  data: ViewData<T>;
  children: (value: T) => ReactNode;
}) {
  if (data.status === "ready") return <>{children(data.value)}</>;

  return (
    <div className="viewstate" role="status" aria-live="polite">
      {data.status === "loading" ? (
        <>
          <div className="viewstate__pulse" aria-hidden="true" />
          <p>Loading…</p>
        </>
      ) : (
        <p>{data.message}</p>
      )}
    </div>
  );
}
