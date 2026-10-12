import { useEffect, useId, useRef, useState } from "react";
import "./TwoPress.css";

/** How far the confirmed action has got. `useSession` reports exactly this. */
export type TwoPressProgress =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

/**
 * An action that cannot be taken back, asked for twice.
 *
 * The first press only asks; the second press is where the question says
 * what it costs (odc-ui: a binding action that cannot be undone confirms).
 * Signing out and forgetting this browser's votes both use it.
 *
 * Accessibility, each learnt the hard way in #344's review:
 * - the question describes the confirm button (`aria-describedby`), because a
 *   screen reader lands on the button, not the sentence;
 * - focus follows the question in and back out, and returns to the confirm
 *   button after a failure;
 * - the confirm button is `aria-disabled` while sending, never `disabled`,
 *   which in a real browser drops focus to the page.
 *
 * Whether the question is showing is this component's own business; the
 * parent hears only the decision (`onConfirm`) and the retreat (`onCancel`).
 */
export function TwoPress({
  label,
  question,
  confirmLabel,
  pendingLabel,
  progress,
  onConfirm,
  onCancel,
}: {
  /** The first button, e.g. "Sign out". Also names the question's group. */
  label: string;
  /** What the second press costs, in one or two sentences. */
  question: string;
  confirmLabel: string;
  pendingLabel: string;
  progress: TwoPressProgress;
  onConfirm: () => void;
  /** The question was put away; a failure from before it is now stale. */
  onCancel: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const questionId = useId();
  const confirm = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) confirm.current?.focus();
    else if (wasAsking.current) start.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  useEffect(() => {
    if (progress.status === "failed") confirm.current?.focus();
  }, [progress.status]);

  const sending = progress.status === "sending";

  if (!asking) {
    return (
      <button
        ref={start}
        type="button"
        className="two-press__action"
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="two-press" role="group" aria-label={label}>
      <p id={questionId} className="two-press__question">
        {question}
      </p>
      <button
        ref={confirm}
        type="button"
        className="two-press__action"
        aria-describedby={questionId}
        aria-disabled={sending}
        onClick={() => {
          if (!sending) onConfirm();
        }}
      >
        {sending ? pendingLabel : confirmLabel}
      </button>
      <button
        type="button"
        className="two-press__action"
        disabled={sending}
        onClick={() => {
          setAsking(false);
          onCancel();
        }}
      >
        Cancel
      </button>
      {progress.status === "failed" ? (
        <p className="two-press__error" role="alert">
          {progress.message}
        </p>
      ) : null}
    </div>
  );
}
