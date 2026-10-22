import { useId } from "react";
import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell.js";
import { TopBanner } from "../components/TopBanner.js";
import { pathOf } from "../flow/route.js";
import "./Trust.css";

/**
 * Static counting guide (#351, #402, ADR-0039). The supplied banner owns session reads.
 * Keep current voting limits separate from the unbuilt ledger's design.
 * "Today" copy changes only after the code does.
 */
export function Trust({ banner }: { banner?: ReactNode }) {
  const id = useId();
  return (
    <AppShell banner={banner ?? <TopBanner signInHref="/sign-in" />}>
      <article className="trust" aria-labelledby={`${id}-title`}>
        <h1 id={`${id}-title`} className="trust__title">
          How votes count
        </h1>
        <p className="trust__lede">What happens now, and what comes next.</p>

        <Part id={`${id}-today`} title="Today">
          <ul className="trust__list">
            <li>
              Press Submit to save your vote. Change it until the question
              closes; your new answer replaces the old one.
            </li>
            <li>
              Votes follow this browser&rsquo;s cookie (a file that remembers
              you). Using another browser, clearing cookies or signing out lets
              you add votes to the full total.
            </li>
            <li>
              Email-confirmed votes count once per account per question. Your
              most recent answer counts. Vote signed in, or sign in on that
              browser before the question closes. Two emails count twice; this
              does not prove each voter is a different person.
            </li>
            <li>
              Email-confirmed votes store a code instead of your email. The
              operator can link it to you with the database and secret key.
            </li>
            <li>
              <strong>
                No public vote record exists yet. Only Pulse&rsquo;s operators
                can check the count today.
              </strong>
            </li>
          </ul>
        </Part>

        <Part id={`${id}-basics`} title="The basics">
          <p className="trust__text">
            The planned ledger is a record that only allows additions. It is not
            built yet.
          </p>
          <ul className="trust__list">
            {BASICS.map((basic) => (
              <li key={basic.term}>
                <strong>{basic.term}:</strong> {basic.text}
              </li>
            ))}
          </ul>
        </Part>

        <Part id={`${id}-plan`} title="The plan">
          <ol className="trust__plan">
            <li>
              <span className="trust__state">Done:</span> Drafted rules and two
              independent checkers, built separately and passing the same tests.
            </li>
            <li>
              <span className="trust__state">Next:</span> A fresh security
              review, then rules ready for final approval.
            </li>
            <li>
              <span className="trust__state">Later:</span> Build the ledger and
              connect Pulse through its public API (how programs talk). Checks
              can expose changed records; they cannot prove every vote was
              entered honestly. Anyone will be able to recount from a public
              copy.
            </li>
          </ol>
        </Part>

        <Part id={`${id}-help`} title="How to help">
          <p className="trust__text">
            Read the{" "}
            <a className="trust__link" href={`${REPO}/tree/master/contracts`}>
              Rules
            </a>{" "}
            or visit the{" "}
            <a className="trust__link" href={REPO}>
              Project
            </a>{" "}
            and{" "}
            <a className="trust__link" href={`${REPO}/issues`}>
              Issues
            </a>{" "}
            to ask questions or report problems.
          </p>
        </Part>

        <p className="trust__text">
          <a className="trust__link" href={pathOf({ kind: "questions" })}>
            Go to the questions
          </a>
        </p>
      </article>
    </AppShell>
  );
}

function Part({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="trust__part" aria-labelledby={id}>
      <h2 id={id} className="trust__heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One sentence per term, all describing the planned record. */
const BASICS: readonly { term: string; text: string }[] = [
  { term: "Hash", text: "a code that changes when data changes." },
  { term: "Chain", text: "each record includes the previous record’s hash." },
  {
    term: "Digital signature",
    text: "a code made with a secret key that others can check.",
  },
  { term: "Public copy", text: "a record anyone can download." },
  {
    term: "Independent checkers",
    text: "separate programs that test the record.",
  },
  {
    term: "Votes in groups",
    text: "groups of at least three share rounded times to make matching votes to people harder; the final group may be smaller.",
  },
];

const REPO = "https://github.com/Will-ODC/odc";
