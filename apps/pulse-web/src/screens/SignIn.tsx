import { useEffect, useId, useRef, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import { looksLikeEmail } from "../flow/email.js";
import "./SignIn.css";

/**
 * Ask for a sign-in link.
 *
 * Signing in is an upgrade, never a gate: a vote counts the moment it is cast,
 * and a link only attaches it to a person. Nothing here blocks the run, which
 * is why this screen is somewhere you can go rather than somewhere you land.
 *
 * **There is no mockup of this screen.** `01-claim.html` was redesigned into
 * the swipe ballot in #97 and nothing replaced the claim design, so the
 * wording, the layout and the dark palette were written from scratch and
 * blessed by the operator on 2026-09-09 rather than taken from the deck. Do
 * not cite `01-claim` or `02-sent` as the design of record here; they depict,
 * respectively, the ballot and a light-palette screen this does not follow.
 *
 * "Check your email" is a state of this screen and not a route of its own. It
 * only means anything as the answer to a form that was just submitted, so a
 * URL you could reload into would show it with nothing behind it.
 */
type Asking =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; email: string }
  /** No community owns this domain yet. An answer, not a fault. */
  | { status: "not_eligible"; message: string }
  /** The request itself did not get through. Nothing to do with the address. */
  | { status: "failed"; message: string };

export function SignIn({ api }: { api: PulseApi }) {
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [asking, setAsking] = useState<Asking>({ status: "idle" });
  /*
   * Held apart from `asking` because it is about the field rather than the
   * request, and it is set on blur rather than on every keystroke: telling
   * someone their address is malformed while they are still typing it is
   * telling them off for not having finished.
   */
  const [fieldError, setFieldError] = useState<string | null>(null);
  const emailId = useId();
  const optInId = useId();
  const errorId = useId();

  const field = useRef<HTMLInputElement>(null);
  /*
   * Set only when someone comes BACK from "check your email", so the form is
   * focused when it is a place they chose to return to and not when the app
   * merely opened here. Autofocusing on arrival would move a screen reader
   * past the heading that says what the screen is for.
   */
  const returning = useRef(false);

  useEffect(() => {
    if (!returning.current) return;
    returning.current = false;
    field.current?.focus();
  }, [asking.status]);

  if (asking.status === "sent") {
    return (
      <LinkSent
        email={asking.email}
        onUseAnother={() => {
          returning.current = true;
          setAsking({ status: "idle" });
        }}
      />
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setFieldError("That does not look like an email address.");
      return;
    }
    setFieldError(null);
    setAsking({ status: "sending" });
    try {
      const result = await api.requestLink(address, optIn);
      setAsking(
        result.status === "sent"
          ? { status: "sent", email: address }
          : { status: "not_eligible", message: result.message },
      );
    } catch (err) {
      /*
       * "A link is already on its way" is good news wearing a 429. Answering
       * it as a failure would tell someone their request did not work when it
       * worked twice — so it lands on the same screen a first request does.
       */
      if (err instanceof ApiError && err.code === "too_many_requests") {
        setAsking({ status: "sent", email: address });
        return;
      }
      setAsking({
        status: "failed",
        message:
          err instanceof ApiError
            ? err.message
            : "We could not send the link. Try again in a moment.",
      });
    }
  };

  const sending = asking.status === "sending";
  /*
   * Only a complaint about the ADDRESS is wired to the field.
   *
   * A request that did not get through is not the field's fault, and marking
   * the input `aria-invalid` and describing it with "we could not reach pulse"
   * tells a screen-reader user to fix an address that is perfectly good.
   */
  const problem =
    fieldError ?? (asking.status === "not_eligible" ? asking.message : null);
  const failure = asking.status === "failed" ? asking.message : null;

  return (
    <ScreenFrame>
      <h1 className="signin__title">Your campus is deciding something.</h1>
      <p className="signin__lede">
        Enter your school email and we will send you a link. There is no
        password to make up.
      </p>

      <form className="signin__form" onSubmit={submit} noValidate>
        <label className="signin__label" htmlFor={emailId}>
          Your school email
        </label>
        <input
          id={emailId}
          ref={field}
          className="signin__field"
          type="email"
          name="email"
          value={email}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          disabled={sending}
          aria-invalid={problem !== null}
          {...(problem !== null ? { "aria-describedby": errorId } : {})}
          onChange={(event) => {
            setEmail(event.target.value);
            // Whatever was wrong is being addressed; keep quiet until they
            // stop typing and it is worth saying again. The answer about the
            // OLD address goes too — a refusal naming a domain they are in
            // the middle of replacing is stale the moment they start typing.
            if (fieldError) setFieldError(null);
            if (
              asking.status === "not_eligible" ||
              asking.status === "failed"
            ) {
              setAsking({ status: "idle" });
            }
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value !== "" && !looksLikeEmail(value)) {
              setFieldError("That does not look like an email address.");
            }
          }}
        />

        <label className="signin__optin" htmlFor={optInId}>
          <input
            id={optInId}
            type="checkbox"
            name="proofEmailsOptIn"
            checked={optIn}
            disabled={sending}
            onChange={(event) => setOptIn(event.target.checked)}
          />
          <span>Email me once when something comes of this.</span>
        </label>

        {problem !== null ? (
          <p className="signin__problem" id={errorId} role="alert">
            {problem}
          </p>
        ) : null}
        {failure !== null ? (
          <p className="signin__problem" role="alert">
            {failure}
          </p>
        ) : null}

        <button className="signin__go" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Continue"}
        </button>
      </form>
    </ScreenFrame>
  );
}

/**
 * What the link being on its way looks like.
 *
 * The address is shown back so a typo is obvious, which is the whole reason
 * this screen names it rather than saying "check your email" and stopping.
 *
 * The server sends its own sentence — "Check your email for a link to sign
 * in." — and this deliberately does not show it. It is a hardcoded literal in
 * `apps/pulse/src/http/server.ts`, it duplicates the heading, and it does not
 * name the address, so ours says strictly more. Ignoring it also means a
 * change to that literal cannot quietly change what this screen reads like.
 *
 * Local to this file on purpose: it is one use, and a shape seen once is a
 * candidate for a component rather than a component.
 */
function LinkSent({
  email,
  onUseAnother,
}: {
  email: string;
  onUseAnother: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  /*
   * The form that was focused has just unmounted, so without this focus falls
   * to `document.body`: a keyboard user has to tab from the top of the page to
   * reach "Use a different email", and a screen reader announces nothing at
   * all. Same reason `AfterVote` and `ResultsPanel` move focus deliberately.
   */
  useEffect(() => heading.current?.focus(), []);

  return (
    <ScreenFrame>
      <h1 className="signin__title" tabIndex={-1} ref={heading}>
        Check your email.
      </h1>
      <p className="signin__lede">
        We sent a link to <b>{email}</b>. Open it and you are in.
      </p>
      <button className="signin__again" type="button" onClick={onUseAnother}>
        Use a different email
      </button>
    </ScreenFrame>
  );
}
