import { useEffect, useRef } from "react";

/**
 * Whether the forms may be filled in. "expired": the session ran out while
 * someone may have been writing; the form stays, with a way to sign in again.
 */
export type Access = "loading" | "signedIn" | "expired" | "signedOut";

/**
 * After a send, the button is disabled while it is pending, so the browser
 * drops keyboard focus to the page. Put it on the outcome instead (the
 * thank-you or the error), unless the person has moved on to something else.
 * Also forgets a "sign in" error once signing in again has fixed it.
 */
export function useSendOutcome(
  save: {
    saved: boolean;
    failure: unknown;
    errorStatus?: number | undefined;
    clearFailure: () => void;
  },
  access: Access,
) {
  const status = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (save.saved && focusLost()) status.current?.focus();
  }, [save.saved]);
  useEffect(() => {
    if (save.failure && focusLost()) alert.current?.focus();
  }, [save.failure]);
  const before = useRef(access);
  const { errorStatus, clearFailure } = save;
  useEffect(() => {
    if (
      before.current === "expired" &&
      access === "signedIn" &&
      errorStatus === 401
    )
      clearFailure();
    before.current = access;
  }, [access, errorStatus, clearFailure]);
  return { status, alert };
}
export function focusLost() {
  const active = document.activeElement;
  return active === null || active === document.body;
}
