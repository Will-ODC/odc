import { IntroPage } from "../components/IntroPage.js";

/** Reviewed static release snapshot, not a rolling or live changelog. */
export function Progress({ onContinue }: { onContinue: () => void }) {
  return (
    <IntroPage title="What we’re building together" compact>
      <h2 className="welcome__section">Built · 6–12 October 2026</h2>
      <ul className="welcome__progress">
        <li>
          <a href="https://github.com/Will-ODC/odc/pull/313">
            Conversation voting on phone and desktop.
          </a>
        </li>
        <li>
          <a href="https://github.com/Will-ODC/odc/pull/322">
            Approval voting that saves all your choices.
          </a>
        </li>
        <li>
          <a href="https://github.com/Will-ODC/odc/pull/344">
            A button to sign out.
          </a>
        </li>
      </ul>
      <h2 className="welcome__section">Why ODC?</h2>
      <ul className="welcome__purpose">
        <li>
          <strong>Your data has value.</strong> Social platforms gain value from
          it. ODC aims to put its control and benefits back in your hands.
        </li>
        <li>
          <strong>Anonymity stays an option.</strong> Optional verification can
          help distinguish real contributions from bots. Everyone’s ballot
          remains equal in ODC’s charter.
        </li>
        <li>
          <strong>Shared resources, shared decisions.</strong> Our goal is to
          pool resources and choose together how to improve members’ wellbeing.
        </li>
      </ul>
      <button type="button" className="welcome__start" onClick={onContinue}>
        Help choose what comes next
      </button>
    </IntroPage>
  );
}
