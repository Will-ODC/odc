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
import { ContributionField as Field } from "../components/ContributionField.js";
import {
  useContributionRead,
  useContributionSave,
} from "../hooks/use-contributions.js";
import { contributionKinds } from "../flow/contributions.js";
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
          <button onClick={reload}>Try again</button>
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
    void save.submit({
      title: value("title"),
      description: value("description"),
      organizerName: value("organizer"),
      kind: value("kind") as ContributionKind,
    });
  }
  return (
    <form className="contribution-form" onSubmit={submit}>
      <fieldset disabled={save.pending}>
        <Field label="Contribution type">
          <select name="kind" defaultValue="project">
            {Object.entries(contributionKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input
            name="title"
            required
            maxLength={160}
            placeholder="What would you like to make happen?"
          />
        </Field>
        <Field
          label="Description"
          hint="Explain what you’re offering or asking for and how people can take part."
        >
          <textarea name="description" required maxLength={4000} rows={5} />
        </Field>
        <Field
          label="Organizer’s public name"
          hint="This name will appear with your contribution."
        >
          <input
            name="organizer"
            required
            maxLength={80}
            autoComplete="nickname"
          />
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
      <button className="contribution-button" disabled={save.pending}>
        {save.pending ? "Publishing…" : "Publish contribution"}
      </button>
    </form>
  );
}
