import { useCallback, useRef, useState } from "react";
import { SEND_FAILED } from "../flow/chat-preview.js";

/**
 * Sending one answer in the chat preview.
 *
 * The choice is carried through every state so the screen can keep showing
 * what was picked while it is on its way, and after it failed.
 */
export type PreviewSubmit =
  | { status: "idle" }
  | { status: "sending"; choiceId: string }
  | { status: "failed"; choiceId: string; message: string }
  | { status: "sent"; choiceId: string };

export interface PreviewSubmitting {
  state: PreviewSubmit;
  submit: (choiceId: string) => void;
  /**
   * Back to `idle`, and forget any send still on its way.
   *
   * Closing the popup mid-send calls this. Without the forgetting, the send
   * would land after the person walked away and turn a dismissed question
   * into an answered one - which is exactly what closing must never do.
   */
  reset: () => void;
}

/**
 * Refusing a second press is the screen's job (`canSubmit` drives the
 * button's `disabled`), not this hook's - one copy of that rule, so a test
 * can reach it. See the same note on `useCastVote`.
 */
export function usePreviewSubmit(
  send: (choiceId: string) => Promise<void>,
): PreviewSubmitting {
  const [state, setState] = useState<PreviewSubmit>({ status: "idle" });
  /** Which send is current. A send that finishes after a reset is stale. */
  const round = useRef(0);

  const submit = useCallback(
    (choiceId: string) => {
      round.current += 1;
      const mine = round.current;
      setState({ status: "sending", choiceId });
      send(choiceId).then(
        () => {
          if (round.current === mine) setState({ status: "sent", choiceId });
        },
        () => {
          if (round.current === mine)
            setState({ status: "failed", choiceId, message: SEND_FAILED });
        },
      );
    },
    [send],
  );

  const reset = useCallback(() => {
    round.current += 1;
    setState({ status: "idle" });
  }, []);

  return { state, submit, reset };
}
