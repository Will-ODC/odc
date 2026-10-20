import { useId } from "react";
import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell.js";
import { TopBanner } from "../components/TopBanner.js";
import { pathOf } from "../flow/route.js";
import "./Trust.css";

/**
 * "Why you can trust your vote" (#351, ADR-0039).
 *
 * Static on purpose: no sign-in, no API calls, nothing that can be loading or
 * fail, so the four view states collapse to one. That is also why it can be
 * opened from a vote card in a new tab without disturbing the conversation.
 *
 * The one rule this copy must keep: it never says or suggests that pulse votes
 * are on a hash chain or a ledger today. They are not. "Today" says what pulse
 * does now; "The basics" explains how the ODC ledger is designed; "The plan"
 * says how pulse gets from one to the other. When the ledger lands, `PLAN`
 * moves forward and "Today" changes with it — in that order, never ahead of
 * the code.
 */
export function Trust() {
  const id = useId();
  return (
    <AppShell banner={<TopBanner />}>
      <article className="trust" aria-labelledby={`${id}-title`}>
        <h1 id={`${id}-title`} className="trust__title">
          Why you can trust your vote
        </h1>
        <p className="trust__lede">
          This page says what pulse does with your vote today, what it cannot
          promise yet, and how the public record that will hold votes is meant
          to work. No sign-in is needed to read it.
        </p>

        <Part id={`${id}-today`} title="Today">
          <ul className="trust__list">
            <li>Your vote is saved as soon as you press Submit.</li>
            <li>
              You can change it until the question closes. A new answer replaces
              the old one. It does not add a second vote.
            </li>
            <li>
              Your vote is tied to this browser, whether or not you sign in. The
              site keeps a small file in it (a cookie) to remember you. Another
              browser or device counts as someone new.
            </li>
            <li>
              Clearing your cookies, pressing &ldquo;Forget my votes
              here&rdquo;, or the cookie running out after 30 days also makes
              you someone new.
            </li>
            <li>
              Signing in shows you can read mail at an email address. It does
              not stop anyone voting twice: every vote still counts in the full
              total.
            </li>
            <li>
              Results also show a second number: votes confirmed by email. A
              vote is confirmed when you are signed in as you vote, or when you
              sign in afterwards on the same browser while the question is open.
              There, each email address counts once per question, with its most
              recent answer. Two addresses still count as two.
            </li>
            <li>
              Pulse does not store your email address next to your answer. A
              confirmed vote keeps a code made from your account and the
              question instead. Only someone holding both pulse&rsquo;s secret
              key and its database could match that code to you.
            </li>
            <li>
              If you sign out and sign back in, the full total treats you as
              someone new, so one person can be counted twice there. The
              confirmed number still counts you once. We accept that so the next
              person on a shared computer cannot see or change your vote.
            </li>
            <li>
              <strong>
                Your vote is not on a public record yet. Nobody outside pulse
                can check the count today.
              </strong>{" "}
              For now, you are trusting the people who run pulse to count
              honestly. The plan below is how that changes.
            </li>
          </ul>
        </Part>

        <Part id={`${id}-basics`} title="The basics">
          <p className="trust__text">
            ODC is the open project pulse is part of: public tools for
            communities to discuss, vote and act together. These are the ideas
            the ODC ledger is designed around. A ledger is a record that is only
            ever added to: nothing in it is changed or removed. The ledger is
            not built yet, and pulse votes are not on it.
          </p>
          {BASICS.map((basic) => (
            <section key={basic.term} className="trust__basic">
              <h3 className="trust__term">{basic.term}</h3>
              {basic.text.map((sentence) => (
                <p key={sentence} className="trust__text">
                  {sentence}
                </p>
              ))}
            </section>
          ))}
        </Part>

        <Part id={`${id}-plan`} title="The plan">
          <p className="trust__text">
            Pulse votes will move onto the ODC ledger. Pulse will send them
            through the ledger&rsquo;s public API: the published way one program
            asks another to do something, open to any program on the same terms.
            There will be no separate record just for pulse.
          </p>
          <p className="trust__text">Where that work stands:</p>
          <ol className="trust__plan">
            {PLAN.map((step) => (
              <li key={step.text} className="trust__step">
                <span className="trust__state">{STATE_LABEL[step.state]}</span>{" "}
                {step.text}
              </li>
            ))}
          </ol>
        </Part>

        <Part id={`${id}-help`} title="How to help">
          <p className="trust__text">
            ODC is built in the open. You can read every rule, check the
            checkers, and point out anything that is wrong or unclear, including
            on this page.
          </p>
          <ul className="trust__list">
            {HELP.map((link) => (
              <li key={link.href}>
                <a className="trust__link" href={link.href}>
                  {link.label}
                </a>
                : {link.why}
              </li>
            ))}
          </ul>
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

/** Each term in two to four short sentences, the jargon explained in place. */
const BASICS: readonly { term: string; text: readonly string[] }[] = [
  {
    term: "Fingerprint (hash)",
    text: [
      "A hash is a short code worked out from a piece of data. The same data always gives the same code.",
      "Change even one letter and the code comes out completely different. So a hash shows whether a record has been changed.",
    ],
  },
  {
    term: "A chain of records",
    text: [
      "Each new record includes the fingerprint of the record before it.",
      "If someone edits an old record, its fingerprint changes and no longer matches the one written in the next record. One edit breaks every link after it, so a change cannot be hidden.",
    ],
  },
  {
    term: "Digital signature",
    text: [
      "A digital signature is a code that only the holder of a secret key can make, but anyone can check with a matching public key.",
      "It proves who wrote a record, and that the record has not changed since. On the ODC ledger the service that accepts a vote signs it, so you never have to look after a key yourself.",
    ],
  },
  {
    term: "A public copy",
    text: [
      "Anyone can download a full copy of the record, in a published format, without an account or permission.",
      "Because many people can hold the same copy, the record cannot be quietly rewritten for some people and not others.",
    ],
  },
  {
    term: "Independent checkers",
    text: [
      "A checker is a program that reads the public copy and tests every fingerprint, link and signature.",
      "ODC has two. They are written in two different programming languages, Go and TypeScript, and each was built without seeing the other's code.",
      "Both must give the same answer on every test record. A mistake in one is much less likely to get past both.",
    ],
  },
  {
    term: "Votes written in groups",
    text: [
      "If each vote were written down the moment it was cast, someone watching could match a vote to the person they saw voting.",
      "So the ledger rounds each vote's time to a set step of at least one minute, and writes votes in groups of at least three that share that time. Only the last group, when voting closes, may be smaller.",
      "That makes it hard to tell which vote in a group belongs to whom.",
    ],
  },
];

type StepState = "done" | "next" | "later";

const STATE_LABEL: Record<StepState, string> = {
  done: "Done:",
  next: "Next:",
  later: "After that:",
};

/**
 * Where the move onto the ledger stands. Status, never dates: update a step's
 * `state` when it moves, and keep "Today" above in step with it.
 */
const PLAN: readonly { state: StepState; text: string }[] = [
  {
    state: "done",
    text: "The rules for the record's format are drafted.",
  },
  {
    state: "done",
    text: "Two independent checkers are built from those rules, and they agree on every test record.",
  },
  {
    state: "next",
    text: "Write the decided changes into the rules and update both checkers to match.",
  },
  {
    state: "later",
    text: "A fresh security review of the rules.",
  },
  {
    state: "later",
    text: "The rules are released as a candidate for final approval.",
  },
  {
    state: "later",
    text: "The ledger itself is built. It does not exist yet.",
  },
  {
    state: "later",
    text: "Pulse sends its votes to the ledger. Then you will be able to check the count yourself.",
  },
];

const REPO = "https://github.com/Will-ODC/odc";

const HELP: readonly { label: string; href: string; why: string }[] = [
  {
    label: "The rules",
    href: `${REPO}/tree/master/contracts`,
    why: "the exact format of every record, and how fingerprints and signatures are made.",
  },
  {
    label: "The charter",
    href: `${REPO}/blob/master/docs/charter.md`,
    why: "the principles ODC has promised to keep.",
  },
  {
    label: "The Go checker",
    href: `${REPO}/tree/master/services/verifier`,
    why: "one of the two independent checkers.",
  },
  {
    label: "The TypeScript checker",
    href: `${REPO}/tree/master/tools/verifier-ts`,
    why: "the other one.",
  },
  {
    label: "Open issues",
    href: `${REPO}/issues`,
    why: "the work in progress. Ask a question or report a problem here.",
  },
  {
    label: "The whole project",
    href: REPO,
    why: "all the code, in one place.",
  },
];
