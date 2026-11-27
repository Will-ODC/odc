import type { Ref } from "react";
import "./SignInAgain.css";

/**
 * Says the session ended and offers the new-tab sign-in; the form stays.
 * Only one copy on the page announces itself, so a screen reader hears it once.
 */
export function SignInAgain({
  href,
  announce = true,
  chooseAgain = false,
  statusRef,
}: {
  href: string;
  announce?: boolean;
  chooseAgain?: boolean;
  statusRef?: Ref<HTMLParagraphElement>;
}) {
  return (
    <p
      className="sign-in-again"
      ref={statusRef}
      tabIndex={statusRef ? -1 : undefined}
      {...(announce ? { role: "status" } : {})}
    >
      Your sign-in has ended. What you wrote stays here.{" "}
      <a href={href} target="_blank" rel="noreferrer">
        Sign in again in a new tab
      </a>{" "}
      to send it.
      {chooseAgain ? " Choose your picture again after you sign in." : null}
    </p>
  );
}
