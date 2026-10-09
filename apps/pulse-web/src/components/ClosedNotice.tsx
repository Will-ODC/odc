import type { ReactNode } from "react";

/**
 * "This one has closed." - said in one place, because it is said in two.
 *
 * `<Outcome>` says it when a cast comes back `closed`, and both ballots say it
 * when the poll was already shut before anyone pressed anything. Either way
 * the words are the same, and the person should not have to read two
 * different sentences for one fact.
 *
 * A status, so a screen reader user is told the question cannot be answered
 * rather than finding the answers switched off and having to guess why. The
 * greying on the ballot is the second way of saying it, never the only one.
 *
 * `children` is whatever control the caller puts under the sentences - the
 * outcome's way back to the question. The ballots pass none: the question is
 * already on screen.
 */
export function ClosedNotice({
  id,
  children,
}: {
  /** For `aria-describedby` on the answers this switches off. */
  id?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="outcome" role="status" id={id}>
      <b>This one has closed.</b>
      <span>Nothing you do here will change it.</span>
      {children}
    </div>
  );
}
