import type { ReactNode } from "react";

import "./ClosedNotice.css";

/** Announces that neither a new answer nor a replacement can be submitted. */
export function ClosedNotice({
  id,
  children,
}: {
  /** For `aria-describedby` on the answers this switches off. */
  id?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="closed-notice" role="status" id={id}>
      <b>This one has closed.</b>
      <span>Nothing you do here will change it.</span>
      {children}
    </div>
  );
}
