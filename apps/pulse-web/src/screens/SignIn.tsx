import { useId, useState } from "react";
import type { PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import { ScreenFrame } from "../components/ScreenFrame.js";
import { looksLikeEmail } from "../flow/email.js";
import "./SignIn.css";

/**
 * Ask for a sign-in link — mockup screens 1 and 2 (`01-claim`, `02-sent`).
 *
 * Signing in is an upgrade, never a gate: a vote counts the moment it is cast,
 * and a link only attaches it to a person. Nothing here blocks the run, which
 * is why this screen is somewhere you can go rather than somewhere you land.
 *
 * "Check your email" is a state of this screen and not a route of its own. It
 * only means anything as the answer to a form that was just submitted, so a
 * URL you could reload into would show it with nothing behind it.
 */
type Asking =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; email: string; message: string | null }
  /** No community owns this domain yet. An answer, not a fault. */
  | { status: "not_eligible"; message: string }
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

  if (asking.status === "sent") {
    return (
      <LinkSent
        email={asking.email}
        message={asking.message}
        onUseAnother={() => setAsking({ status: "idle" })}
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
          ? {
              status: "sent",
              email: address,
              message: result.message ?? null,
            }
          : { status: "not_eligible", message: result.message },
      );
    } catch (err) {
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
  const problem =
    fieldError ??
    (asking.status === "not_eligible" || asking.status === "failed"
      ? asking.message
      : null);

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
            // stop typing and it is worth saying again.
            if (fieldError) setFieldError(null);
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

        <button className="signin__go" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Continue"}
        </button>
      </form>
    </ScreenFrame>
  );
}

/**
 * Mockup screen 2. The address is shown back so a typo is obvious — which is
 * the whole reason this screen names it rather than saying "check your email".
 *
 * Local to this file on purpose: it is one use, and a shape seen once is a
 * candidate for a component rather than a component.
 */
function LinkSent({
  email,
  message,
  onUseAnother,
}: {
  email: string;
  message: string | null;
  onUseAnother: () => void;
}) {
  return (
    <ScreenFrame>
      <h1 className="signin__title">Check your email.</h1>
      <p className="signin__lede">
        {/*
         * The server's own sentence when it sent one — it is documented as
         * safe to show, and it knows things this screen does not, such as how
         * long the link lasts.
         */}
        {message ?? (
          <>
            We sent a link to <b>{email}</b>. Open it and you are in.
          </>
        )}
      </p>
      {message ? <p className="signin__lede signin__address">{email}</p> : null}
      <button className="signin__again" type="button" onClick={onUseAnother}>
        Use a different email
      </button>
    </ScreenFrame>
  );
}
