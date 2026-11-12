import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionsApi,
  type ContributionInput,
  type ContributionKind,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { Field } from "../components/Field.js";
import { Button } from "../components/Button.js";
import {
  useContributionRead,
  useContributionSave,
} from "../hooks/use-contributions.js";
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
  const load = useCallback(() => api.me(), [api]);
  const { data, reload } = useContributionRead(load);
  return (
    <AppShell banner={<PageBanner api={api} />}>
      <section className="contributions-page">
        <a className="contribution-back" href="/?filter=contributions">
          ← Contributions
        </a>
        <h1>Start a contribution</h1>
        <ViewState data={data}>
          {(me) =>
            me ? (
              <ContributionForm client={client} onCreated={onCreated} />
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
            )
          }
        </ViewState>
        {data.status === "error" ? (
          <Button
            variant="secondary"
            size="small"
            className="contribution-retry"
            type="button"
            onClick={reload}
          >
            Try again
          </Button>
        ) : null}
      </section>
    </AppShell>
  );
}
function ContributionForm({
  client,
  onCreated,
}: {
  client: ContributionsApi;
  onCreated: (id: string) => void;
}) {
  const resultId = useRef("");
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
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const pollId = pollReference(value("pollId"));
    if (pollId === undefined) {
      setPollUnreadable(true);
      pollField.current?.focus();
      return;
    }
    setPollUnreadable(false);
    void save.submit({
      title: value("title"),
      description: value("description"),
      organizerName: value("organizer"),
      kind: value("kind") as ContributionKind,
      ...(pollId ? { pollId } : {}),
    });
  }
  return (
    <form className="contribution-form" onSubmit={submit}>
      <fieldset disabled={save.pending}>
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
        <Field id="contribution-title" label="Title" problem={undefined}>
          {(described) => (
            <input
              id="contribution-title"
              className="field__control"
              name="title"
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
          problem={undefined}
        >
          {(described) => (
            <textarea
              id="contribution-description"
              className="field__control"
              name="description"
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
          problem={undefined}
        >
          {(described) => (
            <input
              id="contribution-organizer"
              className="field__control"
              name="organizer"
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
        <label className="contribution-check">
          <input type="checkbox" required disabled={save.pending} />I confirm
          this post may be published with my name.
        </label>
        <p>Keep personal contact and payment details out of your post.</p>
      </div>
      {save.error ? (
        <p role="alert" className="contribution-error">
          {save.error}
        </p>
      ) : null}
      {save.errorStatus === 401 ? (
        <a
          href="/sign-in?next=contribution-new"
          target="_blank"
          rel="noreferrer"
        >
          Sign in (opens in a new tab), then retry here
        </a>
      ) : null}
      <Button variant="primary" disabled={save.pending}>
        {save.pending ? "Publishing…" : "Publish contribution"}
      </Button>
    </form>
  );
}
