import { useCallback, useRef, useState } from "react";
import type { FormEvent, FocusEvent } from "react";
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
    <AppShell banner={<PageBanner api={api} currentHref="/contributions" />}>
      <section className="contributions-page">
        <a className="contribution-back" href="/contributions">
          ← Contributions
        </a>
        <h1>Start a contribution</h1>
        <p className="contribution-intro">
          Describe something useful for your community and how people can take
          part.
        </p>
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
  const [kind, setKind] = useState<ContributionKind>("project");
  const [fund, setFund] = useState(false);
  const [validation, setValidation] = useState("");
  const resultId = useRef("");
  const save = useContributionSave<ContributionInput>(
    async (input, key) => {
      resultId.current = (await client.create(input, key)).id;
    },
    () => onCreated(resultId.current),
  );
  const commercial = kind === "group_buy" || kind === "offer";
  function validatePrices(event: FocusEvent<HTMLInputElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    const values = new FormData(form);
    const regular = String(values.get("regular") ?? "");
    const offered = String(values.get("offered") ?? "");
    if (!regular || !offered) return;
    setValidation(
      Number(offered) > Number(regular) * 0.8
        ? "The community price must save at least 20% against the comparable regular price."
        : "",
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const input: ContributionInput = {
      title: value("title"),
      description: value("description"),
      communityBenefit: value("benefit"),
      needs: value("needs"),
      organizerName: value("organizer"),
      kind,
    };
    if (value("poll")) input.pollId = value("poll");
    if (commercial) {
      const regularPriceMinor = Math.round(Number(value("regular")) * 100);
      const offeredPriceMinor = Math.round(Number(value("offered")) * 100);
      if (
        !Number.isSafeInteger(regularPriceMinor) ||
        !Number.isSafeInteger(offeredPriceMinor) ||
        regularPriceMinor <= 0 ||
        offeredPriceMinor < 0 ||
        offeredPriceMinor > regularPriceMinor * 0.8
      ) {
        setValidation(
          "The community price must save at least 20% against the comparable regular price.",
        );
        return;
      }
      input.commercial = {
        currency: value("currency"),
        regularPriceMinor,
        offeredPriceMinor,
        referenceUrl: value("reference"),
        terms: value("terms"),
      };
    }
    if (fund)
      input.fund = {
        name: value("fundName"),
        percentage: Number(value("fundPercent")),
      };
    setValidation("");
    void save.submit(input);
  }
  return (
    <form className="contribution-form" onSubmit={submit}>
      <fieldset disabled={save.pending}>
        <legend>Tell us about it</legend>
        <Field label="Contribution type">
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as ContributionKind)
            }
          >
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
        <Field label="Description">
          <textarea name="description" required maxLength={4000} rows={5} />
        </Field>
        <Field label="How will the community benefit?">
          <textarea name="benefit" required maxLength={2000} rows={3} />
        </Field>
        <Field
          label="What help or resources are needed?"
          hint="Include the skills, time, materials or funding you need."
        >
          <textarea name="needs" required maxLength={2000} rows={3} />
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
        <Field
          label="Related poll ID (optional)"
          hint="Use the ID after ?poll= in a question’s address."
        >
          <input name="poll" maxLength={200} />
        </Field>
      </fieldset>
      {commercial ? (
        <fieldset disabled={save.pending}>
          <legend>Community savings</legend>
          <p>
            Offers and group buys must provide at least 20% savings on a
            comparable regular price. Include required fees in the prices.
          </p>
          <div className="contribution-fields-row">
            <Field label="Currency">
              <select name="currency">
                <option>CAD</option>
                <option>USD</option>
                <option>GBP</option>
                <option>EUR</option>
              </select>
            </Field>
            <Field label="Regular price">
              <input
                name="regular"
                onBlur={validatePrices}
                type="number"
                min="0.01"
                step="0.01"
                required
              />
            </Field>
            <Field label="Community price">
              <input
                name="offered"
                onBlur={validatePrices}
                aria-invalid={Boolean(validation)}
                aria-describedby={validation ? "savings-error" : undefined}
                type="number"
                min="0"
                step="0.01"
                required
              />
            </Field>
          </div>
          {validation ? (
            <p id="savings-error" role="alert" className="contribution-error">
              {validation}
            </p>
          ) : null}
          <Field label="Comparable price source">
            <input
              name="reference"
              type="url"
              required
              maxLength={2000}
              placeholder="https://"
            />
          </Field>
          <Field
            label="Offer terms"
            hint="Explain what is included, minimum group size, delivery, expiry and any conditions."
          >
            <textarea name="terms" required maxLength={2000} rows={3} />
          </Field>
        </fieldset>
      ) : null}
      <fieldset disabled={save.pending}>
        <legend>Collective funds</legend>
        <label className="contribution-check">
          <input
            type="checkbox"
            checked={fund}
            onChange={(event) => setFund(event.target.checked)}
          />
          Pledge a share of sales proceeds to a collective fund
        </label>
        {fund ? (
          <>
            <Field label="Fund or beneficiary name">
              <input name="fundName" required maxLength={160} />
            </Field>
            <Field label="Share of sales proceeds (%)">
              <input
                name="fundPercent"
                type="number"
                min="1"
                max="100"
                step="1"
                required
              />
            </Field>
            <p className="contribution-note">
              This records your pledge. Payments and transfers are arranged
              outside Pulse.
            </p>
          </>
        ) : null}
      </fieldset>
      <div className="contribution-confirm">
        <label className="contribution-check">
          <input type="checkbox" required disabled={save.pending} />I confirm
          these details are accurate and may be published with my name.
        </label>
        <p>
          Contributions and pledges are public. Keep personal contact and
          payment details out of your post.
        </p>
      </div>
      {save.error ? (
        <p role="alert" className="contribution-error">
          {save.error}
        </p>
      ) : null}
      {save.error ? (
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
