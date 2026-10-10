import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import type { Access, Decision } from "../flow/decision.js";
import { canSubmit, privacyNote } from "../flow/decision.js";
import "./DecisionDialog.css";

/**
 * How far an answer has got. Any hook's state with these statuses fits - the
 * dialog only needs to know which of the four it is in.
 */
export type DialogProgress =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string }
  | { status: "sent" };

export interface DecisionDialogProps {
  decision: Decision;
  /** Controlled: the parent decides when it is showing. */
  open: boolean;
  access: Access;
  /** The choice id currently picked, or `null`. Controlled. */
  picked: string | null;
  progress: DialogProgress;
  onPick: (choiceId: string) => void;
  onSubmit: (choiceId: string) => void;
  /**
   * Every way out: the Close button, the done button, and Escape. The parent
   * decides what closing means - before an answer is sent, it must mean
   * nothing changed.
   */
  onClose: () => void;
  /** What to say once the answer is sent. A slot, because only the caller
   *  knows whether that answer went anywhere. */
  confirmation: ReactNode;
  /** The button under `confirmation` that closes the popup. */
  doneLabel: string;
}

/**
 * One decision, as a popup over whatever opened it.
 *
 * Built on the native `<dialog>` and `showModal()`, which gives the things a
 * hand-rolled overlay gets wrong for free: the page behind is inert, Escape
 * closes it, and it sits in the top layer above everything else.
 *
 * Focus goes back to whatever opened it on every way out - the browser does
 * this for Escape on its own; doing it here as well covers the Close and done
 * buttons, which close the dialog from code.
 *
 * Presentational: it fetches nothing and decides nothing beyond what
 * `flow/decision.ts` already decides. The parent owns what is picked and how
 * an answer is sent.
 */
export function DecisionDialog({
  decision,
  open,
  access,
  picked,
  progress,
  onPick,
  onSubmit,
  onClose,
  confirmation,
  doneLabel,
}: DecisionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  /** Whether the parent still thinks it is open - see `onNativeClose`. */
  const showing = useRef(false);
  /** Whatever had focus when it opened, to hand focus back to. */
  const opener = useRef<HTMLElement | null>(null);
  const questionId = useId();
  const noteId = useId();
  const groupName = useId();

  const answerable = access === "answerable";
  const sending = progress.status === "sending";
  const view =
    progress.status === "sent"
      ? "sent"
      : progress.status === "failed"
        ? "failed"
        : "form";

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    showing.current = open;

    if (!open) {
      if (node.open) node.close();
      const back = opener.current;
      opener.current = null;
      back?.focus();
      return;
    }

    if (!node.open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      node.showModal();
    }
    /*
     * Where focus goes is chosen each time the view changes, not left to the
     * browser: the control that was pressed to get to the confirmation is
     * unmounted by it, and focus left on a removed node falls to the page.
     */
    node.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open, view]);

  /**
   * The dialog closed itself - Escape, in a real browser. Closing it from
   * code fires this too, after the parent already knows, and that one is
   * ignored so a single close is never reported twice.
   */
  function onNativeClose() {
    if (showing.current) onClose();
  }

  const allowed = canSubmit({ decision, access, picked, sending });
  const firstFocus = picked ?? decision.choices[0]?.id ?? null;

  return (
    <dialog
      ref={dialog}
      className="decision"
      aria-labelledby={questionId}
      onClose={onNativeClose}
    >
      <div className="decision__top">
        <p className="decision__eyebrow">DECISION</p>
        <button
          type="button"
          className="decision__close"
          onClick={onClose}
          {...autofocus(view === "form" && !answerable)}
        >
          Close
        </button>
      </div>

      <h2 id={questionId} className="decision__question">
        {decision.question}
      </h2>

      {view === "sent" ? (
        <div className="decision__done">
          <div role="status">{confirmation}</div>
          <button
            type="button"
            className="decision__primary"
            onClick={onClose}
            {...autofocus(true)}
          >
            {doneLabel}
          </button>
        </div>
      ) : (
        <>
          <fieldset
            className="decision__choices"
            aria-labelledby={questionId}
            {...(answerable ? {} : { "aria-describedby": noteId })}
            disabled={!answerable || sending}
          >
            {decision.choices.map((choice) => (
              <label key={choice.id} className="decision__choice">
                <input
                  type="radio"
                  name={groupName}
                  value={choice.id}
                  checked={picked === choice.id}
                  onChange={() => onPick(choice.id)}
                  {...autofocus(
                    view === "form" && answerable && choice.id === firstFocus,
                  )}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </fieldset>

          <p className="decision__privacy">{privacyNote(decision.privacy)}</p>

          {answerable ? (
            <>
              {progress.status === "failed" ? (
                <p className="decision__problem" role="alert">
                  {progress.message}
                </p>
              ) : null}
              <button
                type="button"
                className="decision__primary"
                /*
                 * The one guard against sending twice: `canSubmit` is false
                 * while an answer is on its way, so a second press lands on a
                 * disabled button and does nothing.
                 */
                disabled={!allowed}
                onClick={() => {
                  if (picked !== null) onSubmit(picked);
                }}
                {...autofocus(view === "failed")}
              >
                {primaryLabel(progress)}
              </button>
            </>
          ) : (
            <p id={noteId} className="decision__note">
              {access === "closed"
                ? "This question has closed and is no longer taking answers."
                : "Only confirmed members can answer this question. Another member or your community needs to confirm you first."}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}

/** The one button's words: it sends, then waits, then offers to try again. */
function primaryLabel(progress: DialogProgress): string {
  if (progress.status === "sending") return "Sending…";
  if (progress.status === "failed") return "Try again";
  return "Submit";
}

/**
 * Marks the control that takes focus when the view changes. Spread, because
 * `data-autofocus={false}` would still render the attribute, as "false".
 */
function autofocus(yes: boolean): { "data-autofocus"?: "" } {
  return yes ? { "data-autofocus": "" } : {};
}
