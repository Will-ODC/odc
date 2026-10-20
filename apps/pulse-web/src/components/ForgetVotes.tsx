import { TwoPress } from "./TwoPress.js";
import type { TwoPressProgress } from "./TwoPress.js";

/**
 * "Forget my votes here", for someone who voted without signing in.
 *
 * A browser that votes gets a `pulse_ballot` cookie, signed in or not, and
 * that cookie decides whose ballot it is. On a shared computer the next person
 * would therefore see, and replace, the last person's answers. Signing out
 * clears the cookie, but the way out only shows to a signed-in person; this is
 * the same request for everyone else (`POST /api/sign-out` answers whether or
 * not anyone is signed in, and clears the cookie either way).
 *
 * The votes are not withdrawn. They still count; this browser just stops
 * holding them.
 */
export function ForgetVotes({
  progress,
  onForget,
  onCancel,
}: {
  progress: TwoPressProgress;
  onForget: () => void;
  onCancel: () => void;
}) {
  return (
    <TwoPress
      label="Forget my votes here"
      question="Forget your votes on this browser? They still count, but this browser will no longer show or change them."
      confirmLabel="Forget them"
      pendingLabel="Forgetting…"
      progress={progress}
      onConfirm={onForget}
      onCancel={onCancel}
    />
  );
}
