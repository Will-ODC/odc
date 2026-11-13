import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionsApi,
  type ContributionInput,
  type ContributionKind,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { Field } from "../components/Field.js";
import { Button } from "../components/Button.js";
import { useContributionSave } from "../hooks/use-contributions.js";
import { contributionKinds, pollReference } from "../flow/contributions.js";
import "./Contributions.css";

export function NewContribution({
  api,
  client = contributionsApi,
  onCreated,
}: {
  api: PulseApi;
  client?: ContributionsApi;
  onCreated: (id: string) => void;
}) {
  const mine = useMyVotes(api);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: mine.clear,
    onForgotten: mine.clear,
    recheckSignedIn: true,
  });
  const accountId = session.status === "signedIn" ? session.me.id : null;
  // Keep an expired account's draft for recovery, but never pass it to
  // another account or retain it after someone deliberately signs out.
  const [draft, setDraft] = useState({ owner: accountId, generation: 0 });
  if (accountId !== null && accountId !== draft.owner)
    setDraft({
      owner: accountId,
      generation: draft.generation + (draft.owner === null ? 0 : 1),
    });
  else if (
    session.status === "signedOut" &&
    session.ended !== "expired" &&
    draft.owner !== null
  )
    setDraft({ owner: null, generation: draft.generation + 1 });
  const expired =
    session.status === "signedOut" &&
    session.ended === "expired" &&
    draft.owner !== null;
  return (
    <AppShell
      banner={
        <SiteBanner
          session={session}
          progress={progress}
          holdsVotes={mine.holdsVotes}
          {...(mine.voteRead ? { voteRead: mine.voteRead } : {})}
          onSignOut={signOut}
          onCancel={dismiss}
          signInHref="/sign-in?next=contribution-new"
        />
      }
    >
      <section className="contributions-page">
        <a className="contribution-back" href="/?filter=contributions">
          ← Contributions
        </a>
        <h1>Start a contribution</h1>
        {session.status === "loading" ? (
          <p role="status">Loading…</p>
        ) : accountId !== null || expired ? (
          <ContributionForm
            key={draft.generation}
            client={client}
            onCreated={onCreated}
            expired={expired}
          />
        ) : (
          <div className="contributions-empty">
            <h2>Sign in to get started</h2>
            <p>You can browse every contribution before signing in.</p>
            <a
              className="contribution-button"
              href="/sign-in?next=contribution-new"
            >
              Sign in
            </a>
          </div>
        )}
      </section>
    </AppShell>
  );
}
type RequiredField = "title" | "description" | "organizer" | "confirm";
const requiredMessages: Record<RequiredField, string> = {
  title: "Enter a title.",
  description: "Enter a description.",
  organizer: "Enter the organizer’s public name.",
  confirm: "Confirm that this post may be published.",
};

function ContributionForm({
  client,
  onCreated,
  expired,
}: {
  client: ContributionsApi;
  onCreated: (id: string) => void;
  expired: boolean;
}) {
  const resultId = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const focusProblem = useRef(false);
  const [problems, setProblems] = useState<
    Partial<Record<RequiredField, string>>
  >({});
  useEffect(() => {
    if (!focusProblem.current) return;
    focusProblem.current = false;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [problems]);
  function checkRequired(field: RequiredField) {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const missing = !String(data.get(field) ?? "").trim();
    setProblems((current) => {
      const next = { ...current };
      if (missing) next[field] = requiredMessages[field];
      else delete next[field];
      return next;
    });
  }
  const pollField = useRef<HTMLInputElement>(null);
  /** The related question was not a link or ID, judged here before sending. */
  const [pollUnreadable, setPollUnreadable] = useState(false);
  const save = useContributionSave<ContributionInput>(
    async (input, key) => {
      resultId.current = (await client.create(input, key)).id;
    },
    () => onCreated(resultId.current),
  );
  const pollNotFound = save.errorStatus === 404;
  const pollProblem = pollUnreadable
    ? "This is not a question link or ID. Paste the question’s link, or leave this blank."
    : pollNotFound
      ? "We could not find that question. Check the link, or leave this blank."
      : undefined;
  // The server could not find the question: take the person to the field
  // that says so. Runs after the form is enabled again, so focus can land.
  const { failure } = save;
  useEffect(() => {
    if (failure?.status === 404) pollField.current?.focus();
  }, [failure]);
  function checkPoll() {
    setPollUnreadable(
      pollReference(pollField.current?.value ?? "") === undefined,
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (expired) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const pollId = pollReference(value("pollId"));
    const missing: Partial<Record<RequiredField, string>> = {};
    for (const field of Object.keys(requiredMessages) as RequiredField[])
      if (!value(field)) missing[field] = requiredMessages[field];
    setProblems(missing);
    setPollUnreadable(pollId === undefined);
    if (Object.keys(missing).length || pollId === undefined) {
      focusProblem.current = true;
      return;
    }
    void save.submit({
      title: value("title"),
      description: value("description"),
      organizerName: value("organizer"),
      kind: value("kind") as ContributionKind,
      ...(pollId ? { pollId } : {}),
    });
  }
  return (
    <form
      ref={formRef}
      className="contribution-form"
      noValidate
      onSubmit={submit}
    >
      <fieldset disabled={save.pending || expired}>
        <Field
          id="contribution-kind"
          label="Contribution type"
          problem={undefined}
        >
          {(described) => (
            <select
              id="contribution-kind"
              className="field__control"
              name="kind"
              defaultValue="project"
              {...described}
            >
              {Object.entries(contributionKinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="contribution-title" label="Title" problem={problems.title}>
          {(described) => (
            <input
              id="contribution-title"
              className="field__control"
              name="title"
              aria-invalid={problems.title !== undefined || undefined}
              onBlur={() => checkRequired("title")}
              required
              maxLength={160}
              placeholder="What would you like to make happen?"
              {...described}
            />
          )}
        </Field>
        <Field
          id="contribution-description"
          label="Description"
          hint="Explain what you’re offering or asking for and how people can take part."
          problem={problems.description}
        >
          {(described) => (
            <textarea
              id="contribution-description"
              className="field__control"
              name="description"
              aria-invalid={problems.description !== undefined || undefined}
              onBlur={() => checkRequired("description")}
              required
              maxLength={4000}
              rows={5}
              {...described}
            />
          )}
        </Field>
        <Field
          id="contribution-organizer"
          label="Organizer’s public name"
          hint="This name will appear with your contribution."
          problem={problems.organizer}
        >
          {(described) => (
            <input
              id="contribution-organizer"
              className="field__control"
              name="organizer"
              aria-invalid={problems.organizer !== undefined || undefined}
              onBlur={() => checkRequired("organizer")}
              required
              maxLength={80}
              autoComplete="nickname"
              {...described}
            />
          )}
        </Field>
        <Field
          id="contribution-poll"
          label="Related question (optional)"
          hint="Paste the link to a Pulse question, or its ID."
          problem={pollProblem}
        >
          {(described) => (
            <input
              id="contribution-poll"
              ref={pollField}
              className="field__control"
              name="pollId"
              maxLength={2000}
              autoComplete="off"
              aria-invalid={pollProblem !== undefined || undefined}
              onBlur={checkPoll}
              {...described}
            />
          )}
        </Field>
      </fieldset>
      <div className="contribution-confirm">
        <Field
          id="contribution-confirm"
          label="Publication confirmation"
          problem={problems.confirm}
        >
          {(described) => (
            <label className="contribution-check">
              <input
                id="contribution-confirm"
                name="confirm"
                type="checkbox"
                required
                disabled={save.pending || expired}
                aria-invalid={problems.confirm !== undefined || undefined}
                onBlur={() => checkRequired("confirm")}
                {...described}
              />
              I confirm this post may be published with my name.
            </label>
          )}
        </Field>
        <p>Keep personal contact and payment details out of your post.</p>
      </div>
      {save.error ? (
        <p role="alert" className="contribution-error">
          {save.error}
        </p>
      ) : null}
      {expired || save.errorStatus === 401 ? (
        <a
          href="/sign-in?next=contribution-new"
          target="_blank"
          rel="noreferrer"
        >
          Sign in again in a new tab
        </a>
      ) : null}
      <Button variant="primary" disabled={save.pending || expired}>
        {save.pending ? "Publishing…" : "Publish contribution"}
      </Button>
    </form>
  );
}
