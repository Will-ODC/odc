import { TwoPress } from "./TwoPress.js";
import type { TwoPressProgress } from "./TwoPress.js";
import "./SignedIn.css";

/**
 * Who is signed in, and the way out — what goes in `TopBanner`'s identity slot.
 *
 * Signing out takes two presses (`TwoPress`). It is not undone by signing back
 * in: the server ends every session everywhere and clears this browser's
 * ballot cookie, so this browser can no longer show or change the answers it
 * gave. The answers themselves still count, and the question says so.
 */
export function SignedIn({
  email,
  progress,
  onSignOut,
  onCancel,
}: {
  email: string;
  progress: TwoPressProgress;
  onSignOut: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="signed-in">
      <span className="signed-in__who">{email}</span>
      <TwoPress
        label="Sign out"
        question="Sign out on every device? This browser will stop showing your answers. They still count."
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        progress={progress}
        onConfirm={onSignOut}
        onCancel={onCancel}
      />
    </div>
  );
}
