import type { ReactNode } from "react";
import { IntroPage } from "../components/IntroPage.js";

/** Static introduction; opening the walkthrough never casts a vote. */
export function Welcome({
  onStart,
  banner,
}: {
  onStart: () => void;
  banner?: ReactNode;
}) {
  return (
    <IntroPage
      title="Help shape an Online Democratic Community"
      {...(banner ? { banner } : {})}
    >
      <p className="welcome__lede">
        A place where people discuss ideas, decide together and work toward
        action.
      </p>
      <ol className="welcome__steps" role="list">
        <li>
          <strong>Understand</strong>
          <p>Read the short explanation and the question.</p>
        </li>
        <li>
          <strong>Discuss</strong>
          <p>Compare the ideas. Comments are coming soon.</p>
        </li>
        <li>
          <strong>Vote</strong>
          <p>Choose an answer and press Submit.</p>
        </li>
      </ol>
      <p className="welcome__first">
        We’re starting with this website: its design, data use, funding and when
        to vote again.
      </p>
      <button className="welcome__start" type="button" onClick={onStart}>
        Start voting
      </button>
      <p className="welcome__note">
        <a href="/browse?community=pulse-general">Explore questions</a>
      </p>
    </IntroPage>
  );
}
