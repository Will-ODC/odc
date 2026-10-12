import { useEffect, useRef, useState } from "react";
import "./SignedIn.css";

/** How far a sign-out has got. Structurally `SignOutProgress` in the hook. */
export type SignOutStatus =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

/**
 * Who is signed in, and the way out — what goes in `TopBanner`'s identity slot.
 *
 * Signing out takes two presses on purpose. It is not undone by signing back
 * in: the server ends every session everywhere and clears this browser's
 * ballot cookie, so this browser can no longer show or change the answers it
 * gave. A binding action that cannot be taken back confirms (odc-ui), and the
 * second press is where it says what it costs.
 *
 * Whether the question is showing is this component's own business; the
 * parent hears only the decision, through `onSignOut`.
 */
export function SignedIn({
  email,
  progress,
  onSignOut,
}: {
  email: string;
  progress: SignOutStatus;
  onSignOut: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Focus follows the question in and back out, so a keyboard user is never
  // left on a button that has just disappeared.
  useEffect(() => {
    if (asking) confirm.current?.focus();
    else if (wasAsking.current) start.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const sending = progress.status === "sending";

  if (!asking) {
    return (
      <div className="signed-in">
        <span className="signed-in__who">{email}</span>
        <button
          ref={start}
          type="button"
          className="signed-in__action"
          onClick={() => setAsking(true)}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="signed-in" role="group" aria-label="Sign out">
      <p className="signed-in__question">
        Sign out on every device? This browser will stop showing your answers.
      </p>
      <button
        ref={confirm}
        type="button"
        className="signed-in__action"
        disabled={sending}
        onClick={onSignOut}
      >
        {sending ? "Signing out…" : "Sign out everywhere"}
      </button>
      <button
        type="button"
        className="signed-in__action"
        disabled={sending}
        onClick={() => setAsking(false)}
      >
        Cancel
      </button>
      {progress.status === "failed" ? (
        <p className="signed-in__error" role="alert">
          {progress.message}
        </p>
      ) : null}
    </div>
  );
}
