import { useEffect, useId, useRef, useState } from "react";
import type { CommunityChoice, PulseApi } from "../api/types.js";
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
  /** The request itself did not get through. Nothing to do with the address. */
  | { status: "failed"; message: string }
  /**
   * The address belongs to several communities and the server asked which
   * (P2). Nothing has been sent yet. `sending` is the pick on its way;
   * `failure` is a pick that did not get through, said on this step rather
   * than by throwing the person back to the email field.
   */
  | {
      status: "choosing";
      email: string;
      communities: CommunityChoice[];
      sending: boolean;
      failure: string | null;
    };

const COULD_NOT_SEND = "We could not send the link. Try again in a moment.";

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

  const backToEmail = (failure?: string) => {
    returning.current = true;
    setAsking(
      failure === undefined
        ? { status: "idle" }
        : { status: "failed", message: failure },
    );
  };

  if (asking.status === "sent") {
    return <LinkSent email={asking.email} onUseAnother={() => backToEmail()} />;
  }

  if (asking.status === "choosing") {
    const choosing = asking;
    const pick = async (community: string) => {
      setAsking({ ...choosing, sending: true, failure: null });
      try {
        const result = await api.requestLink(choosing.email, optIn, community);
        if (result.status === "sent") {
          setAsking({ status: "sent", email: choosing.email });
        } else {
          // Asked again despite answering: the list changed underneath them.
          // Show the list the server has now, and say why they are still here.
          setAsking({
            ...choosing,
            communities: result.communities,
            sending: false,
            failure: "That list just changed. Choose again.",
          });
        }
      } catch (err) {
        // Same good news as on the email step.
        if (err instanceof ApiError && err.code === "link_already_sent") {
          setAsking({ status: "sent", email: choosing.email });
          return;
        }
        // The address no longer belongs to what they picked — a row removed
        // between the two requests. Nothing on this step can fix that, so they
        // go back to the address with the server's sentence.
        if (err instanceof ApiError && err.code === "unknown_community") {
          backToEmail(err.message);
          return;
        }
        setAsking({
          ...choosing,
          sending: false,
          failure: err instanceof ApiError ? err.message : COULD_NOT_SEND,
        });
      }
    };
    return (
      <ChooseCommunity
        // A new list is a new question: a pick from the old one must not
        // survive into it and be sent for a community no longer offered.
        key={choosing.communities.map((c) => c.id).join("\n")}
        email={choosing.email}
        communities={choosing.communities}
        sending={choosing.sending}
        failure={choosing.failure}
        onPick={(community) => void pick(community)}
        onBack={() => backToEmail()}
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
      // Anyone with a valid address gets a link. The one other answer is a
      // question: the address belongs to several communities, and the person
      // picks which one before anything is sent (ADR-0023).
      setAsking(
        result.status === "choose_community"
          ? {
              status: "choosing",
              email: address,
              communities: result.communities,
              sending: false,
              failure: null,
            }
          : { status: "sent", email: address },
      );
    } catch (err) {
      /*
       * "A link is already on its way" is good news wearing a 429. Answering
       * it as a failure would tell someone their request did not work when it
       * worked twice — so it lands on the same screen a first request does.
       *
       * Matched on `link_already_sent`, never on the status or on
       * `too_many_requests`: the rate limiter answers 429 with that second slug
       * and means the opposite — nothing was sent, and nothing is coming. That
       * one must fall through to the failure below, or this screen tells the
       * person to go and wait for an email they will never get.
       */
      if (err instanceof ApiError && err.code === "link_already_sent") {
        setAsking({ status: "sent", email: address });
        return;
      }
      setAsking({
        status: "failed",
        message: err instanceof ApiError ? err.message : COULD_NOT_SEND,
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
  const problem = fieldError;
  const failure = asking.status === "failed" ? asking.message : null;

  return (
    <ScreenFrame>
      <h1 className="signin__title">Your campus is deciding something.</h1>
      <p className="signin__lede">
        Enter your email and we will send you a link. There is no password to
        make up.
      </p>

      <form className="signin__form" onSubmit={submit} noValidate>
        <label className="signin__label" htmlFor={emailId}>
          Your email
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
            // stop typing and it is worth saying again. A failure from the
            // last attempt goes too — it is stale the moment they start typing.
            if (fieldError) setFieldError(null);
            if (asking.status === "failed") {
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

/**
 * Which community, when an address belongs to more than one (P2, ADR-0023).
 *
 * The person picks; the app never picks for them, because the community
 * they sign in to is where they may post (ADR-0024). A radio group rather
 * than a button per community so that choosing and sending are two acts: a
 * stray press on the wrong name would otherwise mail a link for it.
 *
 * Communities are shown by their id because that is all the server has —
 * `allowed_domain` holds no display name. If one is added, it goes beside
 * `id` in `CommunityChoice` and is shown here instead.
 *
 * Local to this file for the same reason `LinkSent` is: one use.
 */
function ChooseCommunity({
  email,
  communities,
  sending,
  failure,
  onPick,
  onBack,
}: {
  email: string;
  communities: CommunityChoice[];
  sending: boolean;
  failure: string | null;
  onPick: (community: string) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [unpicked, setUnpicked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const problemId = useId();

  /*
   * The email form has just unmounted. Focus goes to the question, as it does
   * on "Check your email", so a screen reader says what is being asked and a
   * keyboard user is one Tab from the first community.
   */
  useEffect(() => heading.current?.focus(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (picked === null) {
      setUnpicked(true);
      return;
    }
    onPick(picked);
  };

  const problem = unpicked ? "Choose a community first." : failure;

  return (
    <ScreenFrame>
      <h1 className="signin__title" id={headingId} tabIndex={-1} ref={heading}>
        Which community are you signing in to?
      </h1>
      <p className="signin__lede">
        <b>{email}</b> belongs to more than one. Choose the one you are here
        for, and we will send your link.
      </p>

      <form className="signin__form" onSubmit={submit} noValidate>
        <fieldset
          className="signin__choices"
          aria-labelledby={headingId}
          disabled={sending}
          {...(problem !== null ? { "aria-describedby": problemId } : {})}
        >
          {communities.map((community) => (
            <label className="signin__choice" key={community.id}>
              <input
                type="radio"
                name="community"
                value={community.id}
                checked={picked === community.id}
                onChange={() => {
                  setPicked(community.id);
                  setUnpicked(false);
                }}
              />
              <span>{community.id}</span>
            </label>
          ))}
        </fieldset>

        {problem !== null ? (
          <p className="signin__problem" id={problemId} role="alert">
            {problem}
          </p>
        ) : null}

        <button className="signin__go" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send my link"}
        </button>
      </form>

      <button
        className="signin__again"
        type="button"
        onClick={onBack}
        disabled={sending}
      >
        Use a different email
      </button>
    </ScreenFrame>
  );
}
