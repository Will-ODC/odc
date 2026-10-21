import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CreationContext, Poll, PulseApi } from "../api/types.js";
import { ApiError } from "../api/types.js";
import { AppShell } from "../components/AppShell.js";
import { TopBanner } from "../components/TopBanner.js";
import { ViewState } from "../components/ViewState.js";
import { TwoPress } from "../components/TwoPress.js";
import type { TwoPressProgress } from "../components/TwoPress.js";
import {
  LIMITS,
  choiceProblems,
  closingProblem,
  closingSummary,
  defaultCloseNote,
  emptyDraft,
  hasProblems,
  methodSummary,
  nameProblem,
  pickerMin,
  postedAsSummary,
  problemsOf,
  questionProblem,
  requestOf,
} from "../flow/new-poll.js";
import type { Draft, Problems } from "../flow/new-poll.js";
import { useCreationContext } from "../hooks/use-creation-context.js";
import { browserStore } from "../flow/sign-in-return.js";
import { forgetDraft, keepDraft, readDraft } from "../flow/draft-store.js";
import "./SignIn.css";
import "./NewPoll.css";

/** ADR-0037's interim wording, until authorised moderator access exists. */
export const ANONYMITY_NOTE =
  "Your name is hidden from other readers. Pulse keeps your account linked to this post to address abuse.";

/**
 * Posting a question (ADR-0037).
 *
 * Four states: loading, signed out (the way in, which comes back here),
 * could not load, and the form. One screen, as simple and fast as possible
 * (operator): question, choices, Post. The defaults (one choice, seven days,
 * anonymous) are one line each until changed. Posting is a binding act, since
 * a question cannot be edited once it is up, so Post question asks once more
 * in place before it posts.
 */
export function NewPoll({
  api,
  signInHref,
  onPosted,
  newKey = () => crypto.randomUUID(),
  now = () => Date.now(),
  restoreDraft = false,
}: {
  api: PulseApi;
  /**
   * Bring back a draft this browser kept when its post needed a sign-in.
   * Only the way back from that sign-in sets it (App); otherwise the form
   * starts empty and drops any kept draft.
   */
  restoreDraft?: boolean;
  /** Where a signed-out person signs in; it returns them here. */
  signInHref: string;
  onPosted: (poll: Poll) => void;
  /** A fresh idempotency key per intended question. A seam for tests. */
  newKey?: () => string;
  /** The form's clock, for the default closing note. A seam for tests. */
  now?: () => number;
}) {
  const { state, retry, needPromise, signedOut } = useCreationContext(api);
  // An ordinary visit must drop a previous person's draft even when the
  // context is loading, signed out or unavailable and no form mounts.
  useEffect(() => {
    if (!restoreDraft) forgetDraft(browserStore());
  }, [restoreDraft]);
  /** Whether this page just kept a draft, to say so on the way to sign in. */
  const [kept, setKept] = useState(false);
  return (
    <AppShell banner={<TopBanner />}>
      <article className="post">
        {state.status === "signedOut" ? (
          <SignedOut href={signInHref} kept={kept} />
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
                  restoreDraft={restoreDraft}
                  onNeedPromise={needPromise}
                  onSignedOut={(keptDraft) => {
                    setKept(keptDraft);
                    signedOut();
                  }}
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

function SignedOut({ href, kept }: { href: string; kept: boolean }) {
  return (
    <>
      <h1 className="signin__title">Post a question</h1>
      <p className="signin__lede">
        Sign in with your email to post a question. You come back here after.
        Anyone can vote without signing in.
      </p>
      {kept ? (
        <p className="signin__lede" role="status">
          Your question was not posted. What you wrote is kept in this browser
          for an hour, and will be here after you sign in.
        </p>
      ) : null}
      <a className="signin__go post__link-button" href={href}>
        Sign in to post
      </a>
    </>
  );
}

function PostForm({
  api,
  context,
  newKey,
  now,
  onPosted,
  restoreDraft,
  onNeedPromise,
  onSignedOut,
}: {
  api: PulseApi;
  context: CreationContext;
  newKey: () => string;
  now: () => number;
  onPosted: (poll: Poll) => void;
  restoreDraft: boolean;
  onNeedPromise: () => void;
  /** The session ended; `kept` says whether the draft was kept for after. */
  onSignedOut: (kept: boolean) => void;
}) {
  // What was typed before a sign-in the post needed, when coming back from it.
  const [draft, setDraft] = useState<Draft>(
    () =>
      (restoreDraft ? readDraft(browserStore(), now()) : null) ?? emptyDraft(),
  );
  useEffect(() => forgetDraft(browserStore()), []);
  const [shown, setShown] = useState<Problems>({ choices: [] });
  const [sending, setSending] = useState<TwoPressProgress>({ status: "idle" });
  /**
   * One key per intended question: made when Post question is first pressed,
   * kept across retries and Cancel so an uncertain failure cannot post it
   * twice, and dropped on any edit, because an edited question is a
   * different one.
   */
  const key = useRef<string | null>(null);
  /** Bumped to put "Post it?" away: after an edit, or a promise to make. */
  const [asked, setAsked] = useState(0);
  const [open, setOpen] = useState({
    method: false,
    closing: false,
    attribution: false,
  });
  /**
   * The press's own guard, not only the button's: two presses inside one
   * render both find the button enabled. Also stops edits mid-post.
   */
  const inFlight = useRef(false);
  const needsPromise = !context.purposeAcknowledged;
  const id = useId();
  const choiceRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusChoice = useRef<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  /** Set when something needs fixing; acted on once it is drawn. */
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

  // On arrival the heading takes focus and says where the person is.
  useEffect(() => heading.current?.focus(), []);

  function edit(change: (old: Draft) => Draft) {
    // Nothing changes while a post is on its way: the fields are disabled,
    // and this is the guard behind them. An edit then would drop the key
    // and the answer, and a second press could post the question twice.
    if (inFlight.current) return;
    setDraft(change);
    if (key.current !== null || sending.status === "failed") {
      key.current = null;
      setSending({ status: "idle" });
      setAsked((n) => n + 1);
    }
  }

  /** The first press: check everything, and ask only when it can post. */
  function ready(): boolean {
    const problems = problemsOf(draft, needsPromise, now());
    setShown(problems);
    if (hasProblems(problems)) {
      // A kept custom time can expire while signing in. Its field and
      // problem must be visible before the focus moves there.
      if (problems.closing) setOpen((old) => ({ ...old, closing: true }));
      focusProblem.current = true;
      return false;
    }
    // Kept from an earlier press of this same question: an uncertain failure,
    // then Cancel, then Post question again must not post it twice.
    key.current ??= newKey();
    return true;
  }

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
        // Kept for the way back from signing in, which opens a new tab.
        onSignedOut(keepDraft(draft, browserStore(), now()));
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
        setAsked((n) => n + 1);
        focusProblem.current = true;
        return;
      }
      setSending({ status: "failed", message: failureOf(err) });
    } finally {
      inFlight.current = false;
    }
  }

  const choiceShown = (index: number) => shown.choices[index];
  const canAdd = draft.choices.length < LIMITS.maxChoices;
  const canRemove = draft.choices.length > LIMITS.minChoices;

  return (
    <form
      ref={form}
      className="post__form"
      onSubmit={(event) => event.preventDefault()}
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

      <fieldset className="post__lock" disabled={sending.status === "sending"}>
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
                  question
                    ? { ...old, question }
                    : withoutField(old, "question"),
                );
              }}
            />
          )}
        </Field>

        {/* #296 adds an optional context paragraph, links and a photo here. */}

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
          {canAdd ? null : (
            <p className="post__hint">
              {LIMITS.maxChoices} choices is the most a question can have.
            </p>
          )}
        </fieldset>

        <div className="post__settings">
          <Setting
            summary={methodSummary(draft)}
            label="how people answer"
            open={open.method}
            onOpen={() => setOpen((old) => ({ ...old, method: true }))}
          >
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
          </Setting>

          <Setting
            summary={closingSummary(draft, now())}
            label="when it closes"
            open={open.closing}
            onOpen={() => setOpen((old) => ({ ...old, closing: true }))}
          >
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
                  {defaultCloseNote(now())}
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
                      min={pickerMin(now())}
                      value={
                        draft.closing.kind === "chosen"
                          ? draft.closing.local
                          : ""
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
          </Setting>

          <Setting
            summary={postedAsSummary(draft)}
            label="who readers see as the poster"
            open={open.attribution}
            onOpen={() => setOpen((old) => ({ ...old, attribution: true }))}
            describedBy={`${id}-anonymity`}
          >
            <fieldset
              className="post__group"
              aria-describedby={`${id}-anonymity`}
            >
              <legend className="signin__label">
                Who readers see as the poster
              </legend>
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
                        if (shown.name)
                          setShown((old) => withoutField(old, "name"));
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
          </Setting>
          {/* Beside the anonymity control, open or not (ADR-0037). */}
          <p className="post__hint" id={`${id}-anonymity`}>
            {ANONYMITY_NOTE}
          </p>
        </div>

        {needsPromise ? (
          <section className="post__purpose" aria-labelledby={`${id}-purpose`}>
            <h2 id={`${id}-purpose`} className="post__heading">
              What this discussion is for
            </h2>
            <p className="post__text">
              Comments help us turn ideas into action that improves our
              community&rsquo;s wellbeing as much as possible. Be honest,
              listen, and work together.
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
      </fieldset>

      <TwoPress
        key={asked}
        variant="primary"
        label="Post question"
        question="Post it? It can't be changed."
        confirmLabel="Post it"
        pendingLabel="Posting…"
        progress={sending}
        onAsk={ready}
        onConfirm={() => void post()}
        onCancel={() => setSending({ status: "idle" })}
      />
    </form>
  );
}

/**
 * A setting shown as one line until it is wanted (the operator: "as simple
 * and fast as possible"). Change opens its control in place, with focus on
 * the current choice, and it stays open.
 */
function Setting({
  summary,
  label,
  open,
  onOpen,
  describedBy,
  children,
}: {
  summary: string;
  /** What Change changes, for its accessible name: "Change when it closes". */
  label: string;
  open: boolean;
  onOpen: () => void;
  describedBy?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  useEffect(() => {
    if (open && !was.current)
      root.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    was.current = open;
  }, [open]);
  return (
    <div ref={root}>
      {open ? (
        children
      ) : (
        <p className="post__setting">
          <span>{summary}</span>{" "}
          <button
            type="button"
            className="post__change"
            aria-label={`Change ${label}`}
            {...(describedBy ? { "aria-describedby": describedBy } : {})}
            onClick={onOpen}
          >
            Change
          </button>
        </p>
      )}
    </div>
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

/** What to say when a post did not go through, in the server's words. */
function failureOf(err: unknown): string {
  if (!(err instanceof ApiError) || err.status === 0)
    return "We could not reach pulse. Press Post it to try again; it will not be posted twice.";
  if (err.code === "posting_limit" && err.retryAfter !== undefined) {
    const minutes = Math.max(1, Math.ceil(err.retryAfter / 60));
    return `${err.message} You can post again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return err.message;
}

function withoutField(
  problems: Problems,
  field: "question" | "closing" | "name" | "promise",
): Problems {
  const rest = { ...problems };
  delete rest[field];
  return rest;
}
