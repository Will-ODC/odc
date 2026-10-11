import { useEffect, useId, useRef } from "react";
import { VoteCard } from "./VoteCard.js";
import type { VoteCardStatus } from "./VoteCard.js";
import type { ReactNode } from "react";
import type { Access, Decision } from "../flow/decision.js";
import { privacyNote } from "../flow/decision.js";
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
  const doneId = useId();

  const answerable = access === "answerable";
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
    const selector =
      view === "sent"
        ? "[data-autofocus]"
        : !answerable
          ? "button"
          : view === "failed"
            ? ".vote-card__submit"
            : "input:checked, input";
    const selected =
      view === "form" && answerable
        ? node.querySelector<HTMLInputElement>("input:checked")
        : null;
    (selected ?? node.querySelector<HTMLElement>(selector))?.focus();
  }, [open, view, answerable]);

  /**
   * The dialog closed itself - Escape, in a real browser. Closing it from
   * code fires this too, after the parent already knows, and that one is
   * ignored so a single close is never reported twice.
   */
  function onNativeClose() {
    if (showing.current) onClose();
  }

  const pickedIndex = decision.choices.findIndex(
    (choice) => choice.id === picked,
  );
  const cardStatus: VoteCardStatus =
    access !== "answerable"
      ? { kind: access }
      : progress.status === "sending"
        ? { kind: "sending" }
        : progress.status === "failed"
          ? { kind: "failed", message: progress.message }
          : { kind: "answerable" };

  return (
    <dialog
      ref={dialog}
      className="decision"
      aria-label={decision.question}
      onClose={onNativeClose}
    >
      {view === "sent" ? (
        <>
          <div className="decision__top">
            <p className="decision__eyebrow">DECISION</p>
            <button type="button" className="decision__close" onClick={onClose}>
              Close
            </button>
          </div>
          <h2 id={questionId} className="decision__question">
            {decision.question}
          </h2>
          <div className="decision__done">
            <div role="status" id={doneId}>
              {confirmation}
            </div>
            <button
              type="button"
              className="decision__primary"
              aria-describedby={doneId}
              onClick={onClose}
              {...autofocus(true)}
            >
              {doneLabel}
            </button>
          </div>
        </>
      ) : (
        <VoteCard
          question={decision.question}
          why="Pick an answer, then press Submit."
          method="single"
          choices={decision.choices.map((choice, index) => ({
            index,
            label: choice.label,
          }))}
          picked={pickedIndex < 0 ? [] : [pickedIndex]}
          status={cardStatus}
          privacyNote={privacyNote(decision.privacy)}
          collapsed={false}
          onPick={(ballot) => {
            const choice = decision.choices[ballot[0] ?? -1];
            if (choice) onPick(choice.id);
          }}
          onSubmit={(ballot) => {
            const choice = decision.choices[ballot[0] ?? -1];
            if (choice) onSubmit(choice.id);
          }}
          onCollapse={() => {
            /* The modal stays expanded. */
          }}
          onClose={onClose}
        />
      )}
    </dialog>
  );
}

/**
 * Marks the control that takes focus when the view changes. Spread, because
 * `data-autofocus={false}` would still render the attribute, as "false".
 */
function autofocus(yes: boolean): { "data-autofocus"?: "" } {
  return yes ? { "data-autofocus": "" } : {};
}
