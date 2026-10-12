import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { PollMethod, Results } from "../api/types.js";
import {
  numberedChoice,
  pickChoice,
  validCardBallot,
} from "../flow/vote-card.js";
import { ClosedNotice } from "./ClosedNotice.js";
import { ResultsPanel } from "./ResultsPanel.js";
import "./VoteCard.css";

export interface CardChoice {
  index: number;
  label: string;
  detail?: string;
}
export type VoteCardStatus =
  | { kind: "answerable" }
  | { kind: "unconfirmed" }
  | { kind: "closed" }
  | { kind: "sending" }
  | { kind: "failed"; message: string }
  | { kind: "answered"; results: Results; changed: boolean };
export interface VoteCardProps {
  question: string;
  why: string;
  method: PollMethod;
  choices: readonly CardChoice[];
  picked: readonly number[];
  status: VoteCardStatus;
  privacyNote: string;
  collapsed: boolean;
  other?: ReactNode;
  onPick: (picked: number[]) => void;
  onSubmit: (ballot: number[]) => void;
  onCollapse: (collapsed: boolean) => void;
  onClose: () => void;
  onChangeAnswer?: () => void;
  onNext?: () => void;
}

/** Controlled and presentational: the caller owns picks, sending and navigation. */
export function VoteCard({
  question,
  why,
  method,
  choices,
  picked,
  status,
  privacyNote,
  collapsed,
  other,
  onPick,
  onSubmit,
  onCollapse,
  onClose,
  onChangeAnswer,
  onNext,
}: VoteCardProps) {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef<HTMLParagraphElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const previous = useRef({ kind: status.kind, collapsed });
  const editable = status.kind === "answerable" || status.kind === "failed";
  const allowed = editable && validCardBallot(method, choices, picked);
  const submitLabel =
    status.kind === "sending"
      ? "Sending…"
      : status.kind === "failed"
        ? "Try again"
        : "Submit";

  useEffect(() => {
    const before = previous.current;
    previous.current = { kind: status.kind, collapsed };
    if (collapsed && !before.collapsed) {
      card.current?.querySelector<HTMLButtonElement>("[data-expand]")?.focus();
    } else if (
      !collapsed &&
      status.kind === "sending" &&
      before.kind !== "sending"
    ) {
      pending.current?.focus();
    } else if (
      !collapsed &&
      status.kind === "failed" &&
      before.kind !== "failed"
    ) {
      card.current
        ?.querySelector<HTMLButtonElement>(".vote-card__submit")
        ?.focus();
    } else if (
      !collapsed &&
      (status.kind === "closed" || status.kind === "unconfirmed") &&
      before.kind !== status.kind
    ) {
      note.current?.focus();
    } else if (
      !collapsed &&
      status.kind === "answered" &&
      (before.kind !== "answered" || before.collapsed)
    ) {
      panel.current?.focus();
    } else if (
      !collapsed &&
      (before.collapsed || (before.kind === "answered" && editable))
    ) {
      const selected =
        card.current?.querySelector<HTMLInputElement>("input:checked");
      (
        selected ?? card.current?.querySelector<HTMLInputElement>("input")
      )?.focus();
    }
  }, [status.kind, collapsed, editable]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      !editable ||
      collapsed ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    // Typing in the caller's Something else slot must never pick a ballot choice.
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        "textarea, select, [contenteditable], input:not([type=radio]):not([type=checkbox])",
      )
    )
      return;
    const index = numberedChoice(event.key, choices);
    if (index === undefined) return;
    event.preventDefault();
    onPick(pickChoice(method, picked, index));
    card.current
      ?.querySelector<HTMLInputElement>(`input[value="${index}"]`)
      ?.focus();
  }

  if (collapsed) {
    return (
      <section
        ref={card}
        className="vote-card vote-card--collapsed"
        aria-label={question}
      >
        <span className="vote-card__summary">{question}</span>
        <button type="button" data-expand onClick={() => onCollapse(false)}>
          Vote
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </section>
    );
  }

  return (
    <section
      ref={card}
      className="vote-card"
      aria-labelledby={`${id}-question`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        // A second tap on the disabled Submit must not blur the pending status.
        if (
          status.kind === "sending" &&
          event.target instanceof HTMLElement &&
          event.target.closest(".vote-card__submit")
        )
          event.preventDefault();
      }}
    >
      <header className="vote-card__top">
        <span className="vote-card__heading">DECISION</span>
        {/* ResultsPanel provides the answered card's single Close button. */}
        {status.kind !== "answered" ? (
          <button type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>
      <h2 id={`${id}-question`} className="vote-card__question">
        {question}
      </h2>
      <p id={`${id}-why`} className="vote-card__why">
        {why}
      </p>
      {status.kind === "answered" ? (
        <>
          <p role="status" className="vote-card__note">
            {status.changed ? "That replaces your earlier answer." : "Counted."}
          </p>
          <ResultsPanel
            results={status.results}
            yourChoices={picked}
            onClose={onClose}
            panelRef={panel}
          />
          <div className="vote-card__actions">
            {onChangeAnswer ? (
              <button type="button" onClick={onChangeAnswer}>
                Change my answer
              </button>
            ) : null}
            {onNext ? (
              <button type="button" onClick={onNext}>
                Next
              </button>
            ) : null}
          </div>
          <p className="vote-card__note">{privacyNote}</p>
        </>
      ) : (
        <>
          <fieldset
            className="vote-card__choices"
            aria-labelledby={`${id}-question`}
            aria-describedby={`${id}-why ${id}-note`}
            disabled={!editable}
          >
            {choices.map((choice, row) => (
              <label key={choice.index} className="vote-card__choice">
                <input
                  type={method === "single" ? "radio" : "checkbox"}
                  name={id}
                  value={choice.index}
                  checked={picked.includes(choice.index)}
                  aria-labelledby={`${id}-label-${choice.index}`}
                  {...(choice.detail
                    ? { "aria-describedby": `${id}-detail-${choice.index}` }
                    : {})}
                  onChange={() =>
                    onPick(pickChoice(method, picked, choice.index))
                  }
                />
                <span className="vote-card__number" aria-hidden="true">
                  {row + 1}
                </span>
                <span>
                  <b id={`${id}-label-${choice.index}`}>{choice.label}</b>
                  {choice.detail ? (
                    <small id={`${id}-detail-${choice.index}`}>
                      {choice.detail}
                    </small>
                  ) : null}
                </span>
              </label>
            ))}
            {other ? <div className="vote-card__other">{other}</div> : null}
          </fieldset>
          <div
            ref={note}
            tabIndex={-1}
            id={`${id}-note`}
            className="vote-card__note"
          >
            {status.kind === "closed" ? (
              <ClosedNotice />
            ) : status.kind === "unconfirmed" ? (
              <p role="status">
                Only confirmed members can answer this question. Another member
                or your community needs to confirm you first.
              </p>
            ) : null}
          </div>
          {status.kind === "failed" ? (
            <p className="vote-card__problem" role="alert">
              {status.message}
            </p>
          ) : null}
          <footer className="vote-card__foot">
            <p className="vote-card__note">{privacyNote}</p>
            {editable || status.kind === "sending" ? (
              <button
                type="button"
                className="vote-card__submit"
                disabled={!allowed}
                aria-disabled={!allowed}
                onClick={() => {
                  if (allowed) onSubmit([...picked]);
                }}
              >
                {submitLabel}
              </button>
            ) : null}
          </footer>
          {status.kind === "sending" ? (
            <p
              ref={pending}
              tabIndex={-1}
              className="vote-card__note"
              role="status"
            >
              Sending…
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
