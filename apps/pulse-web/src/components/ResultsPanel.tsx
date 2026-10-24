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
 * What people chose. How votes are counted, and why the count can be trusted,
 * is explained on its own page (`/trust`, ADR-0039), linked from the vote
 * card; this panel stays about the answers, and must never claim a public
 * record or a check that pulse does not have yet (`apps/pulse/CLAUDE.md`).
 *
 * Two numbers, side by side (#353, ADR-0040): every vote, one per browser,
 * and the votes confirmed by email, one per person who signed in. The
 * confirmed figures sit under each choice's full figures rather than in a
 * second list, so the two can be read against each other on a phone without
 * scrolling between them. "Confirmed by email" and never "verified": an email
 * address is not a person, and nothing here proves one vote per human.
 */
export function ResultsPanel({
  results,
  yourChoices = [],
  ended = false,
  compact = false,
  onClose,
  panelRef,
  explainHref,
}: {
  results: Results;
  /** Main content already says the saved answer; use tighter results there. */
  compact?: boolean;
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
  /** Omit when the containing card already supplies its close control. */
  onClose?: () => void;
  /**
   * Focus lands here when the panel opens. The control that was pressed is
   * unmounted by the same render, so without this focus falls to the document
   * body: nothing is announced, and the arrow keys the ballot listens for stop
   * reaching it. Focusing a labelled group announces the label and its
   * contents, which is what a live region would have been standing in for.
   */
  panelRef?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * Where "What does this mean?" points: the page that explains what a
   * confirmed vote is (`/trust`). Opened in a new tab, like the card's own
   * link, so the conversation's local history survives. Omit to leave it out.
   */
  explainHref?: string | undefined;
}) {
  // In the order the results list them, so the words read down the list.
  // Right only while a ballot is unordered (`single`, `approval`): a ranked
  // method would need the ballot's own order here, or it drops the ranking.
  const yours = results.choices.filter((choice) =>
    yourChoices.includes(choice.index),
  );
  return (
    <div
      className={compact ? "results results--compact" : "results"}
      role="group"
      aria-label="How people answered"
      ref={panelRef}
      tabIndex={-1}
    >
      {onClose ? (
        <button
          type="button"
          className="results__close"
          aria-label="Close"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      {compact ? null : <p className="ballot__eyebrow">WHERE IT STANDS</p>}
      <p className="results__count">{howMany(results, ended)}</p>
      {explainHref && results.voters > 0 ? (
        <p className="results__explain">
          <a
            className="results__link"
            href={explainHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            What does this mean? (opens in a new tab)
          </a>
        </p>
      ) : null}

      {/*
        Nobody answered: the sentence above says so, and a list of empty bars
        under it would only say it again, worse. The way out stays.
      */}
      {results.voters > 0 ? (
        <Counts
          results={results}
          yours={yours}
          summary={!compact}
          vertical={compact}
        />
      ) : null}
    </div>
  );
}

/** Every choice's count and share, and which one was yours. */
function Counts({
  results,
  yours,
  summary,
  vertical,
}: {
  results: Results;
  yours: readonly ChoiceResult[];
  summary: boolean;
  vertical: boolean;
}) {
  const isYours = (choice: ChoiceResult) =>
    yours.some((one) => one.index === choice.index);
  /* The original horizontal rows use the widest choice as their scale. The
   * compact vertical bars use the percentages themselves against 100. */
  const widest = results.choices.reduce(
    (most, one) => Math.max(most, one.share),
    0,
  );
  const widestConfirmed = results.choices.reduce(
    (most, one) => Math.max(most, one.confirmedShare),
    0,
  );
  /*
   * Nobody confirmed: the count line already says "0 confirmed by email", and
   * a "0 · 0% confirmed" under every choice would only say it again.
   */
  const anyConfirmed = results.confirmedVoters > 0;

  return (
    <>
      {summary && yours.length > 0 ? (
        <p className="results__yours">
          You picked <Labels choices={yours} />.
        </p>
      ) : null}

      {vertical ? (
        <p className="results__denominators">
          Each percentage is a share of {results.voters} total{" "}
          {results.voters === 1 ? "vote" : "votes"}
          {anyConfirmed
            ? ` or ${results.confirmedVoters} email-confirmed ${results.confirmedVoters === 1 ? "vote" : "votes"}, respectively.`
            : "."}
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
                {
                  "--fill": `${vertical ? choice.share : scale(choice.share, widest)}%`,
                } as CSSProperties
              }
            />
            <span className="results__figure">
              {choice.count} · {choice.share}%{vertical ? " of all votes" : ""}
            </span>
            {anyConfirmed ? (
              <>
                <span
                  className="results__bar results__bar--confirmed"
                  aria-hidden="true"
                  style={
                    {
                      "--fill": `${vertical ? choice.confirmedShare : scale(choice.confirmedShare, widestConfirmed)}%`,
                    } as CSSProperties
                  }
                />
                <span className="results__figure results__figure--confirmed">
                  {choice.confirmedCount} · {choice.confirmedShare}% confirmed
                  {vertical ? " by email" : ""}
                </span>
              </>
            ) : null}
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
      {separatorBefore(at, choices.length)}
      <b>{choice.label}</b>
    </Fragment>
  ));
}

/** What goes before the label at `at` of `count`: nothing, ", " or " and ". */
function separatorBefore(at: number, count: number): string {
  if (at === 0) return "";
  return at === count - 1 ? " and " : ", ";
}

/**
 * How many votes there are, and how many of them are confirmed, in words.
 *
 * Nobody is a real answer now. After a vote it cannot happen - the vote just
 * given is in the count - but a closed question's results are open to people
 * who did not vote, and a question can close with nobody having answered it.
 *
 * "Votes", not "people": the full total counts browsers, and one person on
 * two browsers is two votes (see `/trust`). Zero confirmed is said as zero -
 * it is an ordinary answer, not a missing one.
 */
function howMany(results: Results, ended: boolean): string {
  const { voters, confirmedVoters } = results;
  if (voters === 0) {
    return ended ? "Nobody answered this one." : "Nobody has answered yet.";
  }
  const votes = voters === 1 ? "1 vote" : `${voters} votes`;
  const total = ended ? votes : `${votes} so far`;
  return `${total} · ${confirmedVoters} confirmed by email`;
}

/** A bar's width as a share of the widest one, never dividing by zero. */
function scale(share: number, widest: number): number {
  return widest === 0 ? 0 : Math.round((share / widest) * 100);
}
