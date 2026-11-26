import { TwoPress } from "./TwoPress.js";
import type { TwoPressProgress } from "./TwoPress.js";
import "./SignedIn.css";

/**
 * Who is signed in, and the way out — what goes in `TopBanner`'s identity slot.
 *
 * Signing out ends every session and clears this browser's ballot cookie.
 * Public votes stay on the account and appear again after signing back in.
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
      <span className="signed-in__row">
        <a className="signed-in__profile" href="/profile">
          Your profile
        </a>
      </span>
      <TwoPress
        label="Sign out"
        question="Sign out on every device? This browser will stop showing your anonymous answers. They still count, and public votes stay in the results."
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        progress={progress}
        onConfirm={onSignOut}
        onCancel={onCancel}
      />
    </div>
  );
}
