import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { CreationContext, Poll, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import { AppShell } from "../components/AppShell.js";
import { TopBanner } from "../components/TopBanner.js";
import { ViewState } from "../components/ViewState.js";
import {
  LIMITS,
  attributionOf,
  byline,
  choiceProblems,
  chosenClose,
  closingProblem,
  defaultCloseNote,
  emptyDraft,
  hasProblems,
  nameProblem,
  pickerMin,
  problemsOf,
  questionProblem,
  readableClose,
  requestOf,
} from "../flow/new-poll.js";
import type { Draft, Problems } from "../flow/new-poll.js";
import { useCreationContext } from "../hooks/use-creation-context.js";
import "./SignIn.css";
import "./NewPoll.css";

/** ADR-0037's interim wording, until authorised moderator access exists. */
export const ANONYMITY_NOTE =
  "Your name is hidden from other readers. Pulse keeps your account linked to this post to address abuse.";

/**
 * Posting a question (ADR-0037).
 *
 * Four states: loading, signed out (the way in, which comes back here),
 * could not load, and the form. Posting is a binding act, since a question
 * cannot be edited once it is up, so it takes two presses: Review, then
 * Post question.
 */
export function NewPoll({
  api,
  signInHref,
  onPosted,
  newKey = () => crypto.randomUUID(),
  now = () => Date.now(),
}: {
  api: PulseApi;
  /** Where a signed-out person signs in; it returns them here. */
  signInHref: string;
  onPosted: (poll: Poll) => void;
  /** A fresh idempotency key per intended question. A seam for tests. */
  newKey?: () => string;
  /** The form's clock, for the default closing note. A seam for tests. */
  now?: () => number;
}) {
  const { state, retry, needPromise, signedOut } = useCreationContext(api);
  return (
    <AppShell banner={<TopBanner />}>
      <article className="post">
        {state.status === "signedOut" ? (
          <SignedOut href={signInHref} />
        ) : (
          <>
            <ViewState data={state}>
              {(context) => (
                <PostForm
                  api={api}
                  context={context}
                  newKey={newKey}
                  now={now}
                  onPosted={onPosted}
                  onNeedPromise={needPromise}
                  onSignedOut={signedOut}
                />
              )}
            </ViewState>
            {state.status === "error" ? (
              <button type="button" className="signin__again" onClick={retry}>
                Try again
              </button>
            ) : null}
          </>
        )}
      </article>
    </AppShell>
  );
}

function SignedOut({ href }: { href: string }) {
  return (
    <>
      <h1 className="signin__title">Post a question</h1>
      <p className="signin__lede">
        Sign in with your email to post a question. You come back here after.
        Anyone can vote without signing in.
      </p>
      <a className="signin__go post__link-button" href={href}>
        Sign in to post
      </a>
    </>
  );
}

type Sending =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

function PostForm({
  api,
  context,
  newKey,
  now,
  onPosted,
  onNeedPromise,
  onSignedOut,
}: {
  api: PulseApi;
  context: CreationContext;
  newKey: () => string;
  now: () => number;
  onPosted: (poll: Poll) => void;
  onNeedPromise: () => void;
  onSignedOut: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [shown, setShown] = useState<Problems>({ choices: [] });
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState<Sending>({ status: "idle" });
  /**
   * One key per intended question: made on Review, kept across retries so an
   * uncertain failure cannot post it twice, and dropped on Edit, because an
   * edited question is a different one.
   */
  const key = useRef<string | null>(null);
  const [opened] = useState(now);
  const needsPromise = !context.purposeAcknowledged;
  const id = useId();
  const choiceRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusChoice = useRef<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  /** Set by Review when something needs fixing; acted on once it is drawn. */
  const focusProblem = useRef(false);
  useEffect(() => {
    if (focusProblem.current) {
      focusProblem.current = false;
      // To the first field that needs attention, which says what to do.
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
    }
    if (focusChoice.current === null) return;
    const at = focusChoice.current;
    focusChoice.current = null;
    (choiceRefs.current[at] ?? addButton.current)?.focus();
  });

  // On arrival, and between editing and review: what had focus is gone, so
  // the heading takes it and says where the person now is.
  useEffect(() => heading.current?.focus(), [reviewing]);

  function edit(change: (old: Draft) => Draft) {
    setDraft(change);
    if (sending.status === "failed") setSending({ status: "idle" });
  }

  function review(event: FormEvent) {
    event.preventDefault();
    const problems = problemsOf(draft, needsPromise, now());
    setShown(problems);
    if (hasProblems(problems)) {
      focusProblem.current = true;
      return;
    }
    key.current = newKey();
    setSending({ status: "idle" });
    setReviewing(true);
  }

  function backToEditing() {
    key.current = null;
    setSending({ status: "idle" });
    setReviewing(false);
  }

  /**
   * The press's own guard, not only the button's: two presses inside one
   * render both find the button enabled.
   */
  const inFlight = useRef(false);
  async function post() {
    if (inFlight.current || key.current === null) return;
    inFlight.current = true;
    setSending({ status: "sending" });
    try {
      onPosted(
        await api.createPoll(key.current, requestOf(draft, needsPromise)),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSignedOut();
        return;
      }
      if (err instanceof ApiError && err.code === "purpose_required") {
        onNeedPromise();
        key.current = null;
        setShown((old) => ({
          ...old,
          promise: "Tick the promise to post your question.",
        }));
        setSending({ status: "idle" });
        setReviewing(false);
        return;
      }
      setSending({
        status: "failed",
        message:
          err instanceof ApiError && err.status !== 0
            ? err.message
            : "We could not reach pulse. Press Post question to try again; it will not be posted twice.",
      });
    } finally {
      inFlight.current = false;
    }
  }

  if (reviewing) {
    const at =
      draft.closing.kind === "chosen" ? chosenClose(draft.closing.local) : null;
    return (
      <section aria-labelledby={`${id}-review`}>
        <h1
          id={`${id}-review`}
          className="signin__title"
          ref={heading}
          tabIndex={-1}
        >
          Check your question
        </h1>
        <p className="signin__lede">It cannot be changed once it is posted.</p>
        <dl className="post__summary">
          <dt>Question</dt>
          <dd>{draft.question.trim()}</dd>
          <dt>Choices</dt>
          <dd>
            <ol>
              {draft.choices.map((choice, index) => (
                <li key={index}>{choice.trim()}</li>
              ))}
            </ol>
          </dd>
          <dt>How people answer</dt>
          <dd>
            {draft.method === "single" ? "One choice" : "Any number of choices"}
          </dd>
          <dt>Closes</dt>
          <dd>{at ? readableClose(at) : defaultCloseNote(now())}</dd>
          <dt>Readers see</dt>
          <dd>{byline(attributionOf(draft))}</dd>
          <dt>Posted in</dt>
          <dd>{context.community.label}</dd>
        </dl>
        {sending.status === "failed" ? (
          <p className="signin__problem" role="alert">
            {sending.message}
          </p>
        ) : null}
        <div className="post__actions">
          <button
            type="button"
            className="signin__go"
            disabled={sending.status === "sending"}
            onClick={() => void post()}
          >
            {sending.status === "sending" ? "Posting…" : "Post question"}
          </button>
          <button
            type="button"
            className="signin__again"
            disabled={sending.status === "sending"}
            onClick={backToEditing}
          >
            Edit
          </button>
        </div>
      </section>
    );
  }

  const choiceShown = (index: number) => shown.choices[index];
  const canAdd = draft.choices.length < LIMITS.maxChoices;
  const canRemove = draft.choices.length > LIMITS.minChoices;

  return (
    <form
      ref={form}
      className="post__form"
      onSubmit={review}
      noValidate
      aria-labelledby={`${id}-title`}
    >
      <h1
        id={`${id}-title`}
        className="signin__title"
        ref={heading}
        tabIndex={-1}
      >
        Post a question
      </h1>
      <p className="signin__lede">
        Posting in <b>{context.community.label}</b>.
      </p>

      <Field
        id={`${id}-question`}
        label="Your question"
        problem={shown.question}
      >
        {(described) => (
          <textarea
            id={`${id}-question`}
            className="signin__field post__question"
            rows={3}
            value={draft.question}
            aria-invalid={shown.question !== undefined}
            {...described}
            onChange={(event) => {
              const question = event.target.value;
              edit((old) => ({ ...old, question }));
              if (shown.question)
                setShown((old) => withoutField(old, "question"));
            }}
            onBlur={() => {
              if (draft.question.trim() === "") return;
              const question = questionProblem(draft.question);
              setShown((old) =>
                question ? { ...old, question } : withoutField(old, "question"),
              );
            }}
          />
        )}
      </Field>

      <fieldset className="post__group">
        <legend className="signin__label">Choices</legend>
        <ol className="post__choices">
          {draft.choices.map((choice, index) => {
            const problem = choiceShown(index);
            const inputId = `${id}-choice-${index}`;
            return (
              <li key={index} className="post__choice">
                <label className="post__visually-hidden" htmlFor={inputId}>
                  Choice {index + 1}
                </label>
                <span className="post__number" aria-hidden="true">
                  {index + 1}
                </span>
                <input
                  id={inputId}
                  ref={(node) => {
                    choiceRefs.current[index] = node;
                  }}
                  className="signin__field"
                  value={choice}
                  aria-invalid={problem !== undefined}
                  {...(problem
                    ? { "aria-describedby": `${inputId}-problem` }
                    : {})}
                  onChange={(event) => {
                    const text = event.target.value;
                    edit((old) => ({
                      ...old,
                      choices: old.choices.map((one, at) =>
                        at === index ? text : one,
                      ),
                    }));
                    if (problem)
                      setShown((old) => ({
                        ...old,
                        choices: old.choices.map((one, at) =>
                          at === index ? undefined : one,
                        ),
                      }));
                  }}
                  onBlur={() => {
                    if (draft.choices[index]?.trim() === "") return;
                    const found = choiceProblems(draft.choices)[index];
                    setShown((old) => {
                      const choices = [...old.choices];
                      choices[index] = found;
                      return { ...old, choices };
                    });
                  }}
                />
                {canRemove ? (
                  <button
                    type="button"
                    className="post__remove"
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => {
                      edit((old) => ({
                        ...old,
                        choices: old.choices.filter((_, at) => at !== index),
                      }));
                      setShown((old) => ({
                        ...old,
                        choices: old.choices.filter((_, at) => at !== index),
                      }));
                      // The choice that took its place, or the last one left.
                      focusChoice.current = Math.min(
                        index,
                        draft.choices.length - 2,
                      );
                    }}
                  >
                    Remove
                  </button>
                ) : null}
                {problem ? (
                  <p
                    className="signin__problem post__problem"
                    id={`${inputId}-problem`}
                  >
                    {problem}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          ref={addButton}
          className="signin__again post__add"
          disabled={!canAdd}
          onClick={() => {
            edit((old) => ({ ...old, choices: [...old.choices, ""] }));
            focusChoice.current = draft.choices.length;
          }}
        >
          Add a choice
        </button>
        <p className="post__hint">
          {canAdd
            ? `Between ${LIMITS.minChoices} and ${LIMITS.maxChoices} choices.`
            : `${LIMITS.maxChoices} choices is the most a question can have.`}
        </p>
      </fieldset>

      <fieldset className="post__group">
        <legend className="signin__label">How people answer</legend>
        <div className="signin__choices">
          <Option
            name={`${id}-method`}
            checked={draft.method === "single"}
            onPick={() => edit((old) => ({ ...old, method: "single" }))}
          >
            One choice
          </Option>
          <Option
            name={`${id}-method`}
            checked={draft.method === "approval"}
            onPick={() => edit((old) => ({ ...old, method: "approval" }))}
          >
            Any number of choices
          </Option>
        </div>
      </fieldset>

      <fieldset className="post__group">
        <legend className="signin__label">When it closes</legend>
        <div className="signin__choices">
          <Option
            name={`${id}-closing`}
            checked={draft.closing.kind === "default"}
            onPick={() => {
              edit((old) => ({ ...old, closing: { kind: "default" } }));
              setShown((old) => withoutField(old, "closing"));
            }}
          >
            {defaultCloseNote(opened)}
          </Option>
          <Option
            name={`${id}-closing`}
            checked={draft.closing.kind === "chosen"}
            onPick={() =>
              edit((old) =>
                old.closing.kind === "chosen"
                  ? old
                  : { ...old, closing: { kind: "chosen", local: "" } },
              )
            }
          >
            At a time I pick
          </Option>
        </div>
        {draft.closing.kind === "chosen" ? (
          <Field
            id={`${id}-closes`}
            label="Closing time"
            problem={shown.closing}
          >
            {(described) => (
              <input
                id={`${id}-closes`}
                type="datetime-local"
                className="signin__field"
                min={pickerMin(opened)}
                value={
                  draft.closing.kind === "chosen" ? draft.closing.local : ""
                }
                aria-invalid={shown.closing !== undefined}
                {...described}
                onChange={(event) => {
                  const local = event.target.value;
                  edit((old) => ({
                    ...old,
                    closing: { kind: "chosen", local },
                  }));
                  if (shown.closing)
                    setShown((old) => withoutField(old, "closing"));
                }}
                onBlur={() => {
                  const closing = closingProblem(draft, now());
                  setShown((old) =>
                    closing
                      ? { ...old, closing }
                      : withoutField(old, "closing"),
                  );
                }}
              />
            )}
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="post__group" aria-describedby={`${id}-anonymity`}>
        <legend className="signin__label">Who readers see as the poster</legend>
        <div className="signin__choices">
          <Option
            name={`${id}-attribution`}
            checked={draft.attribution.kind === "anonymous"}
            onPick={() => {
              edit((old) => ({
                ...old,
                attribution: { ...old.attribution, kind: "anonymous" },
              }));
              setShown((old) => withoutField(old, "name"));
            }}
          >
            Nobody: post anonymously
          </Option>
          <Option
            name={`${id}-attribution`}
            checked={draft.attribution.kind === "named"}
            onPick={() =>
              edit((old) => ({
                ...old,
                attribution: { ...old.attribution, kind: "named" },
              }))
            }
          >
            A name I choose
          </Option>
        </div>
        <p className="post__hint" id={`${id}-anonymity`}>
          {ANONYMITY_NOTE}
        </p>
        {draft.attribution.kind === "named" ? (
          <Field
            id={`${id}-name`}
            label="Name to show"
            hint="Shown exactly as you type it. Pulse does not check it, so readers cannot tell whether it is your real name."
            problem={shown.name}
          >
            {(described) => (
              <input
                id={`${id}-name`}
                className="signin__field"
                autoComplete="off"
                value={draft.attribution.name}
                aria-invalid={shown.name !== undefined}
                {...described}
                onChange={(event) => {
                  const name = event.target.value;
                  edit((old) => ({
                    ...old,
                    attribution: { kind: "named", name },
                  }));
                  if (shown.name) setShown((old) => withoutField(old, "name"));
                }}
                onBlur={() => {
                  if (draft.attribution.name.trim() === "") return;
                  const name = nameProblem(draft);
                  setShown((old) =>
                    name ? { ...old, name } : withoutField(old, "name"),
                  );
                }}
              />
            )}
          </Field>
        ) : null}
      </fieldset>

      {needsPromise ? (
        <section className="post__purpose" aria-labelledby={`${id}-purpose`}>
          <h2 id={`${id}-purpose`} className="post__heading">
            What this discussion is for
          </h2>
          <p className="post__text">
            Comments help us turn ideas into action that improves our
            community&rsquo;s wellbeing as much as possible. Be honest, listen,
            and work together.
          </p>
          <p className="post__text">
            When we disagree, say so respectfully. Decide on a compromise
            together, or try different ways to solve the same problem. Keep
            talking and share what works.
          </p>
          <label className="signin__optin post__promise">
            <input
              type="checkbox"
              checked={draft.promised}
              aria-invalid={shown.promise !== undefined}
              {...(shown.promise
                ? { "aria-describedby": `${id}-promise-problem` }
                : {})}
              onChange={(event) => {
                const promised = event.target.checked;
                edit((old) => ({ ...old, promised }));
                if (promised) setShown((old) => withoutField(old, "promise"));
              }}
            />
            <b>
              I will discuss ideas without attacking, harassing or threatening
              people.
            </b>
          </label>
          {shown.promise ? (
            <p className="signin__problem" id={`${id}-promise-problem`}>
              {shown.promise}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="post__reminder">
          <b>Be honest. Respect people. Help us move forward.</b>
        </p>
      )}

      <button type="submit" className="signin__go">
        Review
      </button>
    </form>
  );
}

/**
 * A labelled field with its hint and problem. The control is a render
 * function so it gets the right `aria-describedby` without repeating it.
 */
function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem: string | undefined;
  children: (described: { "aria-describedby"?: string }) => ReactNode;
}) {
  const ids = [
    ...(hint ? [`${id}-hint`] : []),
    ...(problem ? [`${id}-problem`] : []),
  ];
  return (
    <div className="post__field">
      <label className="signin__label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="post__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {})}
      {problem ? (
        <p className="signin__problem" id={`${id}-problem`}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function Option({
  name,
  checked,
  onPick,
  children,
}: {
  name: string;
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <label className="signin__choice">
      <input type="radio" name={name} checked={checked} onChange={onPick} />
      <span>{children}</span>
    </label>
  );
}

function withoutField(
  problems: Problems,
  field: "question" | "closing" | "name" | "promise",
): Problems {
  const rest = { ...problems };
  delete rest[field];
  return rest;
}
