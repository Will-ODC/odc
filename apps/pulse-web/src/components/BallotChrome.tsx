import type { Poll } from "../api/types.js";
import privacyMark from "../assets/privacy-mark.svg";

/**
 * The top of every ballot: the way back, the mark, what kind of thing this is,
 * and the question. Shared because both ballots open the same way, and a
 * person moving from one to the next should not feel the screen change under
 * them - which is also why back is here rather than on each screen.
 *
 * `onBack` is absent on the question the run opened on. The control is then
 * not rendered at all rather than disabled: there is nothing behind the first
 * question, and a dead button is a worse answer than no button.
 */
export function BallotChrome({
  poll,
  onBack,
}: {
  poll: Poll;
  onBack?: (() => void) | undefined;
}) {
  return (
    <header className="ballot__head">
      {onBack ? (
        <button
          type="button"
          className="ballot__back"
          onClick={onBack}
          /*
           * The swipe ballot answers arrow keys on the whole section, and this
           * button sits inside it, so a keydown here would bubble up and be
           * read as a vote. Someone who tabs to Back and presses the left
           * arrow — the most guessable key on a screen whose control is drawn
           * as a left chevron — would cast a ballot for the left choice
           * instead of going back.
           *
           * Stopped here rather than filtered there, so the screen keeps one
           * plain rule (an arrow answers the question) and the control that is
           * not part of answering opts itself out.
           */
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span aria-hidden="true">{"\u2039"}</span> Back
        </button>
      ) : null}
      <div className="ballot__brand">
        <i aria-hidden="true" /> pulse
      </div>
      <img src={privacyMark} width="92" height="83" alt="" />
      <span className="ballot__chip">{chipFor(poll)}</span>
      <h1 className="ballot__question">{poll.question}</h1>
    </header>
  );
}

/** What kind of thing this is, and when it closes if the poll says. */
export function chipFor(poll: Poll): string {
  if (!poll.closesAt) return "Official Ballot";
  const closes = new Date(poll.closesAt);
  if (Number.isNaN(closes.getTime())) return "Official Ballot";
  const day = closes.toLocaleDateString(undefined, { weekday: "long" });
  return `Official Ballot - Closes ${day}`;
}
