import type { Poll } from "../api/types.js";

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
        <button type="button" className="ballot__back" onClick={onBack}>
          <span aria-hidden="true">{"\u2039"}</span> Back
        </button>
      ) : null}
      <div className="ballot__brand">
        <i aria-hidden="true" /> pulse
      </div>
      <PrivacyMark />
      <span className="ballot__chip">{chipFor(poll)}</span>
      <h1 className="ballot__question">{poll.question}</h1>
    </header>
  );
}

/** The incognito motif: this vote is yours, and stays that way. */
function PrivacyMark() {
  return (
    <svg
      width="92"
      height="83"
      viewBox="0 0 132 120"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M44 62 C44 34 55 26 66 26 C77 26 88 34 88 62 Z"
        fill="rgba(255,255,255,.92)"
      />
      <ellipse cx="66" cy="63" rx="46" ry="8.5" fill="rgba(255,255,255,.92)" />
      <path
        d="M30 80 h10"
        stroke="rgba(255,255,255,.8)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M92 80 h10"
        stroke="rgba(255,255,255,.8)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="38"
        y="74"
        width="26"
        height="18"
        rx="9"
        fill="rgba(255,255,255,.12)"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
      />
      <rect
        x="68"
        y="74"
        width="26"
        height="18"
        rx="9"
        fill="rgba(255,255,255,.12)"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
      />
      <path
        d="M64 81 h4"
        stroke="rgba(255,255,255,.85)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
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
