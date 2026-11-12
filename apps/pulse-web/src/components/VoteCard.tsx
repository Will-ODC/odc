import { Fragment, useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { PollMethod, Results } from "../api/types.js";
import {
  countedNote,
  numberedChoice,
  pickChoice,
  validCardBallot,
} from "../flow/vote-card.js";
import type { Confirmation } from "../flow/vote-card.js";
import { ClosedNotice } from "./ClosedNotice.js";
import { QuestionPager, type MyVotesNavigation } from "./QuestionPager.js";
import { ResultsPanel } from "./ResultsPanel.js";
import { ViewState } from "./ViewState.js";
import "./VoteCard.css";

const dismissIcon = (
  <svg
    className="vote-card__chevron"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

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
  /** Results can live in the page instead of the voting card. */
  presentation?: "card" | "results";
  /**
   * The desktop layout (#490): the card sits in the page right under the
   * question, so it drops its label and the repeated question, closes with a
   * visible "Close" only while changing an answer (`closable`), and "Change
   * my answer" sits on the "You picked" line; a quiet "Next question ›" ends
   * the actions row.
   */
  inPage?: boolean;
  closable?: boolean;
  /**
   * The caller is asking the server which answer it holds after a failed
   * send (#527). Close stays where it is but does nothing, Try again waits,
   * and the card says it is checking in place of the old problem.
   */
  checking?: boolean;
  /** Who posted it: "Posted anonymously" or "Posted by …". Left out for a
   *  question from before posting existed. */
  byline?: string;
  why?: string;
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
  /** Previous/Next in My votes order; null ends stay visibly disabled. */
  myVotesNavigation?: MyVotesNavigation;
  /**
   * Where "Why you can trust your vote" points (#351). Shown only once a vote
   * is counted, and opened in a new tab so the conversation, whose history is
   * local to this page, is still there to come back to.
   */
  trustHref?: string;
  /**
   * Whether the counted vote is confirmed by email (#353). Left out, the card
   * says only "Counted" and offers nothing.
   */
  confirmation?: Confirmation;
  /**
   * Where the confirm offer's Sign in (#480) points, shown only while `confirmation` is
   * `offer`. Opened in a new tab, so this card is still here, and updates,
   * once the person has signed in.
   */
  confirmHref?: string;
  /**
   * Fresh results were asked for and did not come. The card keeps the vote's
   * status, and shows this in place of the numbers, with a way to ask again.
   */
  resultsProblem?: { message: string; onRetry: () => void };
  /** Whether the results are minimized (#478); see `ResultsPanel`. */
  resultsHidden?: boolean;
  onResultsHidden?: (hidden: boolean) => void;
}

/** Controlled and presentational: the caller owns picks, sending and navigation. */
export function VoteCard({
  question,
  presentation = "card",
  inPage = false,
  closable = false,
  checking = false,
  byline,
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
  myVotesNavigation,
  trustHref,
  confirmation = "unknown",
  confirmHref,
  resultsProblem,
  resultsHidden,
  onResultsHidden,
}: VoteCardProps) {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef<HTMLParagraphElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const previous = useRef({ kind: status.kind, collapsed });
  const editable = status.kind === "answerable" || status.kind === "failed";
  const allowed =
    editable && !checking && validCardBallot(method, choices, picked);
  // Close keeps focus while a check runs: marked, not removed or disabled.
  const closeProps = {
    "aria-disabled": checking || undefined,
    onClick: () => {
      if (!checking) onClose();
    },
  };
  // While sending, Submit keeps its name and is unavailable: "Sending…" is
  // said once, by the status line under it that takes focus (#575).
  const submitLabel = status.kind === "failed" ? "Try again" : "Submit";

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

  // "Try again" on fresh results unmounts itself, and so does the panel the
  // failure replaces: when focus was on either, keep it on the results area
  // rather than let it fall to the page. Focus elsewhere is left alone.
  const problem = Boolean(resultsProblem);
  const hadProblem = useRef(problem);
  useEffect(() => {
    if (hadProblem.current === problem) return;
    hadProblem.current = problem;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!collapsed && status.kind === "answered" && lost)
      panel.current?.focus();
  }, [problem, collapsed, status.kind]);

  // The confirm offer's Sign in (#480) goes once the vote is confirmed. When focus was
  // on it, it would fall to the page; the note that now says "confirmed by
  // email" takes it instead. Focus elsewhere is left alone.
  const counted = useRef<HTMLParagraphElement>(null);
  const wasOffer = useRef(confirmation === "offer");
  useEffect(() => {
    const offer = confirmation === "offer";
    if (wasOffer.current === offer) return;
    wasOffer.current = offer;
    const active = document.activeElement;
    if (!offer && (active === null || active === document.body))
      counted.current?.focus();
  }, [confirmation]);

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

  // What to do next: a quiet "Next question" at the end of the row (#554).
  const actions = (
    <div className="vote-card__actions">
      {onChangeAnswer && !inPage ? (
        <button type="button" onClick={onChangeAnswer}>
          Change my answer
        </button>
      ) : null}
      {trustHref ? (
        <a
          className="vote-card__info"
          href={trustHref}
          aria-label="How votes count (opens in a new tab)"
          title="How votes count"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span aria-hidden="true">i</span>
        </a>
      ) : null}
      {myVotesNavigation ? (
        <QuestionPager navigation={myVotesNavigation} />
      ) : onNext ? (
        <button type="button" className="vote-card__next" onClick={onNext}>
          Next question<span aria-hidden="true"> ›</span>
        </button>
      ) : null}
    </div>
  );

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
        <button
          type="button"
          className="vote-card__close"
          aria-label="Close"
          {...closeProps}
        >
          {dismissIcon}
        </button>
      </section>
    );
  }

  return (
    <section
      ref={card}
      className={[
        "vote-card",
        presentation === "results" ? "vote-card--results" : "",
        inPage ? "vote-card--page" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={
        presentation === "results"
          ? "Your answer"
          : inPage
            ? question
            : undefined
      }
      aria-labelledby={
        presentation === "card" && !inPage ? `${id}-question` : undefined
      }
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
      {presentation === "card" && !inPage ? (
        <>
          <header className="vote-card__top">
            <span className="vote-card__heading">DECISION</span>
            <button
              type="button"
              className="vote-card__close"
              aria-label="Close"
              {...closeProps}
            >
              {dismissIcon}
            </button>
          </header>
          <h2 id={`${id}-question`} className="vote-card__question">
            {question}
          </h2>
          {byline ? <p className="vote-card__why">{byline}</p> : null}
          {why ? (
            <p id={`${id}-why`} className="vote-card__why">
              {why}
            </p>
          ) : null}
        </>
      ) : null}
      {status.kind === "answered" ? (
        <>
          {/*
            On the question page the saved answer leads (#478): what you
            picked, with the vote's status at the end of the same line.
          */}
          <div
            className={
              presentation === "results" ? "vote-card__yours" : undefined
            }
            {...(inPage ? { tabIndex: -1 } : {})}
          >
            {presentation === "results" ? (
              <span>
                You picked <Picked choices={choices} picked={picked} />.
              </span>
            ) : null}
            <p
              role="status"
              className="vote-card__note"
              ref={counted}
              tabIndex={-1}
            >
              {countedNote(status.changed, confirmation)}
            </p>
            {inPage && onChangeAnswer ? (
              <button
                type="button"
                className="vote-card__change"
                onClick={onChangeAnswer}
              >
                Change my answer
              </button>
            ) : null}
          </div>
          {/*
            One short line (#480). "Confirm", never "verify": an email does
            not prove one vote per person (ADR-0040). The new tab is in the
            name, so a screen reader still hears it.
          */}
          {confirmation === "offer" && confirmHref ? (
            <p className="vote-card__confirm">
              Sign in to confirm your vote.{" "}
              <a
                className="vote-card__signin"
                href={confirmHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Sign in to confirm your vote (opens in a new tab)"
              >
                Sign in
              </a>
            </p>
          ) : null}
          {/* One card holds the results and what to do next (#478). */}
          <div
            className={
              presentation === "results" ? "vote-card__results" : undefined
            }
          >
            {resultsProblem ? (
              <div
                className="results"
                role="group"
                aria-label="How people answered"
                ref={panel}
                tabIndex={-1}
              >
                <ViewState
                  data={{ status: "error", message: resultsProblem.message }}
                >
                  {() => null}
                </ViewState>
                <button
                  type="button"
                  className="results__retry"
                  onClick={resultsProblem.onRetry}
                >
                  Try again
                </button>
              </div>
            ) : (
              <ResultsPanel
                results={status.results}
                compact={presentation === "results"}
                yourChoices={picked}
                panelRef={panel}
                {...(resultsHidden !== undefined && onResultsHidden
                  ? { hidden: resultsHidden, onHiddenChange: onResultsHidden }
                  : {})}
              />
            )}
            {actions}
          </div>
          {presentation === "card" ? (
            <p className="vote-card__note">{privacyNote}</p>
          ) : null}
        </>
      ) : (
        <>
          <fieldset
            className="vote-card__choices"
            {...(inPage
              ? { "aria-label": question }
              : { "aria-labelledby": `${id}-question` })}
            aria-describedby={why ? `${id}-why ${id}-note` : `${id}-note`}
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
          {checking ? (
            <p className="vote-card__note" role="status">
              Checking your answer…
            </p>
          ) : status.kind === "failed" ? (
            <p className="vote-card__problem" role="alert">
              {status.message}
            </p>
          ) : null}
          <footer className="vote-card__foot">
            <p className="vote-card__note">{privacyNote}</p>
            {inPage && closable ? (
              <button
                type="button"
                className="vote-card__dismiss"
                {...closeProps}
              >
                Close
              </button>
            ) : null}
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

/** "A", "A and B": the labels of what was picked, each in bold. */
function Picked({
  choices,
  picked,
}: {
  choices: readonly CardChoice[];
  picked: readonly number[];
}) {
  const labels = choices.filter((choice) => picked.includes(choice.index));
  return labels.map((choice, at) => (
    <Fragment key={choice.index}>
      {at === 0 ? "" : at === labels.length - 1 ? " and " : ", "}
      <b>{choice.label}</b>
    </Fragment>
  ));
}
