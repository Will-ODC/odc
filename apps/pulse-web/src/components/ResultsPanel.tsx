import { Fragment } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ChoiceResult, Results } from "../api/types.js";
import "./ResultsPanel.css";

/**
 * Where the question stands.
 *
 * Shown in two places, and only ever when asked for. On an open question it
 * waits until after a vote: the point of the run is to answer, and a screen
 * that leads with the numbers invites people to agree with them instead of
 * saying what they think. On a closed question there is nothing left to
 * answer, so it is open to anyone - voted or not - as the record of how the
 * question ended (operator decision, 2026-10-09).
 *
 * What people chose, never how the choosing is counted - that boundary is the
 * one thing this component must not cross. No wording about tallies, records
 * or verification belongs here (`apps/pulse/CLAUDE.md`).
 */
export function ResultsPanel({
  results,
  yourChoices = [],
  ended = false,
  onClose,
  panelRef,
}: {
  results: Results;
  /**
   * The indexes of the choices this person picked - one on a `single` poll,
   * any number on an `approval` one. Matched against `ChoiceResult.index`,
   * never used as positions in `results.choices`, which may arrive in any
   * order (ADR-0021).
   *
   * Empty or absent when there is nothing to mark: someone reading a closed
   * question they never answered, or whose earlier answer could not be loaded.
   */
  yourChoices?: readonly number[] | undefined;
  /**
   * The question has closed, so the count is a final one. "So far" would
   * promise more answers to come on a question that can take no more.
   */
  ended?: boolean | undefined;
  onClose: () => void;
  /**
   * Focus lands here when the panel opens. The control that was pressed is
   * unmounted by the same render, so without this focus falls to the document
   * body: nothing is announced, and the arrow keys the ballot listens for stop
   * reaching it. Focusing a labelled group announces the label and its
   * contents, which is what a live region would have been standing in for.
   */
  panelRef?: RefObject<HTMLDivElement | null> | undefined;
}) {
  // In the order the results list them, so the words read down the list.
  const yours = results.choices.filter((choice) =>
    yourChoices.includes(choice.index),
  );
  return (
    <div
      className="results"
      role="group"
      aria-label="How people answered"
      ref={panelRef}
      tabIndex={-1}
    >
      <p className="ballot__eyebrow">WHERE IT STANDS</p>
      <p className="results__count">{howMany(results.voters, ended)}</p>

      {/*
        Nobody answered: the sentence above says so, and a list of empty bars
        under it would only say it again, worse. The way out stays.
      */}
      {results.voters > 0 ? <Counts results={results} yours={yours} /> : null}

      {/*
        Not "Back": the chrome's own back control is on screen at the same time
        and abandons the question entirely. Two controls both starting with the
        same word, doing opposite things, is how someone loses their place.
      */}
      <button type="button" className="results__close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Every choice's count and share, and which one was yours. */
function Counts({
  results,
  yours,
}: {
  results: Results;
  yours: readonly ChoiceResult[];
}) {
  const isYours = (choice: ChoiceResult) =>
    yours.some((one) => one.index === choice.index);
  /**
   * The widest share on screen, so the bars are read against each other rather
   * than against a hundred that nothing may reach. An `approval` poll can push
   * a single share past most of the scale and a `single` poll can leave every
   * bar short; both look wrong drawn against a fixed 100.
   */
  const widest = results.choices.reduce(
    (most, one) => Math.max(most, one.share),
    0,
  );

  return (
    <>
      {yours.length > 0 ? (
        <p className="results__yours">
          You picked <Labels choices={yours} />.
        </p>
      ) : null}

      <ul className="results__list">
        {results.choices.map((choice) => (
          <li
            key={choice.index}
            className="results__row"
            {...(isYours(choice) ? { "data-yours": "true" } : {})}
          >
            <span className="results__label">
              {choice.label}
              {isYours(choice) ? (
                <span className="results__badge">yours</span>
              ) : null}
            </span>
            <span
              className="results__bar"
              aria-hidden="true"
              style={
                { "--fill": `${scale(choice.share, widest)}%` } as CSSProperties
              }
            />
            <span className="results__figure">
              {choice.count} · {choice.share}%
            </span>
          </li>
        ))}
      </ul>

      {results.method === "approval" ? (
        <p className="results__fine">
          People could pick more than one, so these add up to more than
          everybody.
        </p>
      ) : null}
    </>
  );
}

/** "A", "A and B", "A, B and C" - each label in bold. */
function Labels({ choices }: { choices: readonly ChoiceResult[] }) {
  return choices.map((choice, at) => (
    <Fragment key={choice.index}>
      {at === 0 ? "" : at === choices.length - 1 ? " and " : ", "}
      <b>{choice.label}</b>
    </Fragment>
  ));
}

/**
 * How many people answered, in words.
 *
 * Nobody is a real answer now. After a vote it cannot happen - the vote just
 * given is in the count - but a closed question's results are open to people
 * who did not vote, and a question can close with nobody having answered it.
 */
function howMany(voters: number, ended: boolean): string {
  if (voters === 0) {
    return ended ? "Nobody answered this one." : "Nobody has answered yet.";
  }
  const people = voters === 1 ? "1 person" : `${voters} people`;
  return ended ? `${people} answered` : `${people} so far`;
}

/** A bar's width as a share of the widest one, never dividing by zero. */
function scale(share: number, widest: number): number {
  return widest === 0 ? 0 : Math.round((share / widest) * 100);
}
