import { useCallback, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionsApi,
  type Contribution,
  type ParticipationInput,
  type ParticipationKind,
  type UpdateInput,
  type ContributionStatus,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { ContributionField as Field } from "../components/ContributionField.js";
import {
  useContributionRead,
  useContributionSave,
} from "../hooks/use-contributions.js";
import {
  contributionKinds,
  contributionStatuses,
  money,
  savings,
  safeExternalLink,
} from "../flow/contributions.js";
import "./Contributions.css";

export function ContributionDetail({
  api,
  id,
  client = contributionsApi,
}: {
  api: PulseApi;
  id: string;
  client?: ContributionsApi;
}) {
  const load = useCallback(() => client.detail(id), [client, id]);
  const { data, reload, setData } = useContributionRead(load);
  function changed(contribution: Contribution) {
    if (data.status === "ready")
      setData({ status: "ready", value: { ...data.value, contribution } });
  }
  return (
    <AppShell banner={<PageBanner api={api} currentHref="/contributions" />}>
      <section className="contributions-page">
        <a className="contribution-back" href="/contributions">
          ← Contributions
        </a>
        <ViewState data={data}>
          {({ contribution: item, canManage }) => (
            <>
              <header className="contribution-detail-heading">
                <div className="contribution-meta">
                  <span>{contributionKinds[item.kind]}</span>
                  <span>{contributionStatuses[item.status]}</span>
                </div>
                <h1>{item.title}</h1>
                <p>
                  Organized by {item.organizerName} · {item.community.label}
                </p>
              </header>
              <section className="contribution-section">
                <h2>Description</h2>
                <p className="contribution-prose">{item.description}</p>
              </section>
              {item.communityBenefit ? (
                <section className="contribution-benefit">
                  <h2>Community benefit</h2>
                  <p>{item.communityBenefit}</p>
                </section>
              ) : null}
              {item.needs ? (
                <section className="contribution-section">
                  <h2>What’s needed</h2>
                  <p className="contribution-prose">{item.needs}</p>
                </section>
              ) : null}
              {item.commercial ? (
                <section className="contribution-offer">
                  <h2>Community savings</h2>
                  <p className="contribution-price">
                    {money(
                      item.commercial.offeredPriceMinor,
                      item.commercial.currency,
                    )}{" "}
                    <span>{savings(item.commercial)}% advertised savings</span>
                  </p>
                  <p>
                    Comparable regular price{" "}
                    {money(
                      item.commercial.regularPriceMinor,
                      item.commercial.currency,
                    )}
                  </p>
                  <a
                    href={safeExternalLink(item.commercial.referenceUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View the price comparison ↗
                  </a>
                  <h3>Offer terms</h3>
                  <p className="contribution-prose">{item.commercial.terms}</p>
                  <p className="contribution-note">
                    Prices and availability are provided by the organizer.
                    Arrange purchases directly with them.
                  </p>
                </section>
              ) : null}
              {item.fund ? (
                <section className="contribution-section">
                  <h2>Collective fund pledge</h2>
                  <p>
                    The organizer pledges {item.fund.percentage}% of sales
                    proceeds to {item.fund.name}.
                  </p>
                  <p className="contribution-note">
                    This is a stated commitment. Pulse does not collect or
                    transfer these funds.
                  </p>
                </section>
              ) : null}
              {item.pollId ? (
                <p>
                  <a href={`/?poll=${encodeURIComponent(item.pollId)}`}>
                    Read the related question →
                  </a>
                </p>
              ) : null}
              <section className="contribution-section">
                <h2>Take part</h2>
                <ParticipationForm
                  key={item.id}
                  client={client}
                  item={item}
                  changed={changed}
                />
              </section>
              <section className="contribution-section">
                <h2>People contributing</h2>
                {item.participations.length ? (
                  <ul className="contribution-timeline">
                    {item.participations.map((entry) => (
                      <li key={entry.id}>
                        <div className="contribution-meta">
                          <strong>{entry.displayName}</strong>
                          <span>{participationLabels[entry.kind]}</span>
                        </div>
                        <p className="contribution-prose">{entry.message}</p>
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="contribution-note">
                    Be the first to offer help or share what you have done.
                  </p>
                )}
              </section>
              <section className="contribution-section">
                <h2>Progress and evidence</h2>
                <p className="contribution-note">
                  Updates and completion are reported by the organizer. Evidence
                  is available for the community to assess.
                </p>
                {item.updates.length ? (
                  <ul className="contribution-timeline">
                    {item.updates.map((entry) => (
                      <li key={entry.id}>
                        <div className="contribution-meta">
                          <strong>{contributionStatuses[entry.status]}</strong>
                          <time dateTime={entry.createdAt}>
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </time>
                        </div>
                        <p className="contribution-prose">{entry.message}</p>
                        {entry.evidenceUrl ? (
                          <a
                            href={safeExternalLink(entry.evidenceUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View evidence ↗
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No progress updates yet.</p>
                )}
                {canManage ? (
                  <UpdateForm client={client} item={item} changed={changed} />
                ) : null}
              </section>
            </>
          )}
        </ViewState>
        {data.status === "error" ? (
          <button
            className="contribution-button contribution-button--secondary"
            onClick={reload}
          >
            Try again
          </button>
        ) : null}
      </section>
    </AppShell>
  );
}
const participationLabels: Record<ParticipationKind, string> = {
  help: "Offer of help",
  pledge: "Pledge",
  report: "Reported contribution",
};
function ParticipationForm({
  client,
  item,
  changed,
}: {
  client: ContributionsApi;
  item: Contribution;
  changed: (item: Contribution) => void;
}) {
  const closed = item.status === "completed" || item.status === "cancelled";
  const [kind, setKind] = useState<ParticipationKind>(
    closed ? "report" : "help",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const save = useContributionSave<ParticipationInput>(
    async (input, key) =>
      changed(await client.participate(item.id, input, key)),
    () => formRef.current?.reset(),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.submit({
      kind: closed ? "report" : kind,
      displayName: String(form.get("name") ?? "").trim(),
      message: String(form.get("message") ?? "").trim(),
    });
  }
  return (
    <form className="contribution-form" ref={formRef} onSubmit={submit}>
      <p>
        Sign in to publish an offer, pledge or report. Your name and message
        will be public.
      </p>
      <a
        href={`/sign-in?contribution=${encodeURIComponent(item.id)}`}
        target="_blank"
        rel="noreferrer"
      >
        Sign in (opens in a new tab)
      </a>
      <fieldset disabled={save.pending}>
        <Field label="How would you like to contribute?">
          <select
            value={closed ? "report" : kind}
            onChange={(event) =>
              setKind(event.target.value as ParticipationKind)
            }
          >
            {!closed ? (
              <>
                <option value="help">Offer help</option>
                <option value="pledge">Make a pledge</option>
              </>
            ) : null}
            <option value="report">Report work done</option>
          </select>
        </Field>
        <Field label="Your public name">
          <input name="name" required maxLength={80} autoComplete="nickname" />
        </Field>
        <Field
          label="Your contribution"
          hint="Describe what you can provide or what you have done. Keep contact and payment details private."
        >
          <textarea name="message" rows={3} required maxLength={2000} />
        </Field>
        {kind === "pledge" && !closed ? (
          <p className="contribution-note">
            A pledge records your intention. No money is collected on this page.
          </p>
        ) : null}
        <label className="contribution-check">
          <input type="checkbox" required />I confirm this contribution may be
          published with my name.
        </label>
      </fieldset>
      {save.error ? (
        <p role="alert" className="contribution-error">
          {save.error}
        </p>
      ) : null}
      {save.saved ? (
        <p role="status">Your contribution has been published.</p>
      ) : null}
      <button className="contribution-button" disabled={save.pending}>
        {save.pending ? "Publishing…" : "Publish my contribution"}
      </button>
    </form>
  );
}
function UpdateForm({
  client,
  item,
  changed,
}: {
  client: ContributionsApi;
  item: Contribution;
  changed: (item: Contribution) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useContributionSave<UpdateInput>(
    async (input, key) => changed(await client.update(item.id, input, key)),
    () => formRef.current?.reset(),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const evidenceUrl = String(form.get("evidence") ?? "").trim();
    void save.submit({
      message: String(form.get("message") ?? "").trim(),
      status: String(form.get("status")) as ContributionStatus,
      ...(evidenceUrl ? { evidenceUrl } : {}),
    });
  }
  return (
    <form
      className="contribution-form contribution-update"
      ref={formRef}
      onSubmit={submit}
    >
      <h3>Post an organizer update</h3>
      <fieldset disabled={save.pending}>
        <Field label="Current status">
          <select name="status" defaultValue={item.status}>
            {Object.entries(contributionStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Progress update">
          <textarea name="message" required maxLength={2000} rows={3} />
        </Field>
        <Field label="Evidence link (optional)">
          <input
            name="evidence"
            type="url"
            maxLength={2000}
            placeholder="https://"
          />
        </Field>
        <label className="contribution-check">
          <input type="checkbox" required />I confirm this status and update may
          be published.
        </label>
      </fieldset>
      {save.error ? <p role="alert">{save.error}</p> : null}
      {save.saved ? <p role="status">Your update has been published.</p> : null}
      <button className="contribution-button" disabled={save.pending}>
        {save.pending ? "Publishing…" : "Publish update"}
      </button>
    </form>
  );
}
