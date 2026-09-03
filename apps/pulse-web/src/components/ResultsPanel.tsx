import type { CSSProperties, RefObject } from "react";
import type { Results } from "../api/types.js";
import "./ResultsPanel.css";

/**
 * Where the question stands, once someone has answered it.
 *
 * Shown only after a vote, and only when asked for: the point of the run is to
 * answer, and a screen that leads with the numbers invites people to agree
 * with them instead of saying what they think.
 *
 * What people chose, never how the choosing is counted - that boundary is the
 * one thing this component must not cross. No wording about tallies, records
 * or verification belongs here (`apps/pulse/CLAUDE.md`).
 */
export function ResultsPanel({
  results,
  yourChoice,
  onClose,
  panelRef,
}: {
  results: Results;
  /** Position in the poll's choices that this person picked. */
  yourChoice: number;
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
  const yours = results.choices[yourChoice];
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
    <div
      className="results"
      role="group"
      aria-label="How people answered"
      ref={panelRef}
      tabIndex={-1}
    >
      <p className="ballot__eyebrow">WHERE IT STANDS</p>
      <p className="results__count">{peopleSoFar(results.voters)}</p>

      {yours ? (
        <p className="results__yours">
          You picked <b>{yours.label}</b>.
        </p>
      ) : null}

      <ul className="results__list">
        {results.choices.map((choice) => (
          <li
            key={choice.index}
            className="results__row"
            {...(choice.index === yourChoice ? { "data-yours": "true" } : {})}
          >
            <span className="results__label">
              {choice.label}
              {choice.index === yourChoice ? (
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

/** Nobody has voted is impossible here - this is only shown after a vote. */
function peopleSoFar(voters: number): string {
  return voters === 1 ? "1 person so far" : `${voters} people so far`;
}

/** A bar's width as a share of the widest one, never dividing by zero. */
function scale(share: number, widest: number): number {
  return widest === 0 ? 0 : Math.round((share / widest) * 100);
}
