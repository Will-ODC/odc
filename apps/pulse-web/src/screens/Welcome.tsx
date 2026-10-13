import { IntroPage } from "../components/IntroPage.js";

/** Static introduction; opening the walkthrough never casts a vote. */
export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <IntroPage title="Help shape an Online Democratic Community">
      <p className="welcome__lede">
        A place where people discuss ideas, decide together and work toward
        action.
      </p>
      <ol className="welcome__steps">
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
    </IntroPage>
  );
}
