import { useCallback, useRef } from "react";
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
  const save = useContributionSave<ContributionInput>(
    async (input, key) => {
      resultId.current = (await client.create(input, key)).id;
    },
    () => onCreated(resultId.current),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const pollId = pollReference(value("pollId"));
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
          problem={
            save.errorStatus === 404
              ? "We could not find that question. Check the link, or leave this blank."
              : undefined
          }
        >
          {(described) => (
            <input
              id="contribution-poll"
              name="pollId"
              maxLength={2000}
              autoComplete="off"
              aria-invalid={save.errorStatus === 404 || undefined}
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
