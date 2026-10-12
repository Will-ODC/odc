import { TopBanner } from "../components/TopBanner.js";
import "./Welcome.css";

/** Static content: the first published poll is supplied by the entry point. */
export function Welcome({
  ready,
  onStart,
}: {
  ready: boolean;
  onStart: () => void;
}) {
  return (
    <div className="welcome">
      <header>
        <TopBanner signInHref="/sign-in" />
      </header>
      <main className="welcome__main">
        <h1>Help shape an Online Democratic Community</h1>
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
          We’re starting with this website: its design, data use, funding and
          when to vote again.
        </p>
        <button
          className="welcome__start"
          type="button"
          disabled={!ready}
          aria-describedby={ready ? undefined : "welcome-start-note"}
          onClick={onStart}
        >
          Start voting
        </button>
        {!ready ? (
          <p id="welcome-start-note" className="welcome__note">
            The first vote is being prepared. Please come back when it is ready.
          </p>
        ) : null}
      </main>
    </div>
  );
}
