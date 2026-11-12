import { useCallback, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  type ContributionsApi,
  type Contribution,
  type ParticipationKind,
  type UpdateInput,
  type ContributionStatus,
} from "../api/contributions.js";
import { AppShell } from "../components/AppShell.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { AnsweredRail } from "../components/AnsweredRail.js";
import { SuggestedVotesRail } from "../components/SuggestedVotesRail.js";
import { useMyVotes } from "../hooks/use-my-votes.js";
import { useSession, type Session } from "../hooks/use-session.js";
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
  const mine = useMyVotes(api);
  const [railRetried, setRailRetried] = useState(false);
  const clearVotes = () => {
    setRailRetried(false);
    mine.clear();
  };
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clearVotes,
    onForgotten: clearVotes,
  });
  const accountId = session.status === "signedIn" ? session.me.id : null;
  const load = useCallback(async () => {
    const detail = await client.detail(id);
    return { ...detail, accountId };
  }, [client, id, accountId]);
  const { data, reload, setData } = useContributionRead(load);
  const canManage =
    accountId !== null &&
    data.status === "ready" &&
    data.value.accountId === accountId &&
    data.value.canManage;
  function changed(contribution: Contribution) {
    if (data.status === "ready")
      setData({ status: "ready", value: { ...data.value, contribution } });
  }
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
        />
      }
      nav={
        <AnsweredRail
          data={mine.data}
          votes={mine.data.status === "ready" ? mine.data.value.votes : []}
          railRetried={railRetried}
          onRetry={() => {
            setRailRetried(true);
            mine.retry();
          }}
        />
      }
      aside={
        <SuggestedVotesRail
          api={api}
          history={mine.data}
          retryHistory={mine.retry}
        />
      }
    >
      <section className="contributions-page">
        <a className="contribution-back" href="/?filter=contributions">
          ← Contributions
        </a>
        <ViewState data={data}>
          {({ contribution: item }) => (
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
                {canManage ? (
                  <OrganizerInbox key={item.id} client={client} id={item.id} />
                ) : (
                  <details className="contribution-disclosure">
                    <summary className="contribution-button contribution-button--secondary">
                      Message the organizer
                    </summary>
                    <MessageForm
                      key={item.id}
                      session={session}
                      client={client}
                      id={item.id}
                    />
                  </details>
                )}
              </section>
              {item.participations.length ? (
                <section className="contribution-section">
                  <h2>People contributing</h2>
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
                </section>
              ) : null}
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
                  <details className="contribution-disclosure">
                    <summary className="contribution-button contribution-button--secondary">
                      Post an update
                    </summary>
                    <UpdateForm client={client} item={item} changed={changed} />
                  </details>
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
function MessageForm({
  session,
  client,
  id,
}: {
  session: Session;
  client: ContributionsApi;
  id: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useContributionSave<string>(
    (message, key) => client.sendMessage(id, message, key),
    () => formRef.current?.reset(),
  );
  const signInHref = `/sign-in?contribution=${encodeURIComponent(id)}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = String(
      new FormData(event.currentTarget).get("message") ?? "",
    ).trim();
    if (message) void save.submit(message);
  }
  if (session.status === "loading") return <p role="status">Loading…</p>;
  if (session.status !== "signedIn")
    return <a href={signInHref}>Sign in to send a message</a>;
  return (
    <form className="contribution-form" ref={formRef} onSubmit={submit}>
      <Field label="Private message">
        <textarea
          name="message"
          rows={3}
          required
          maxLength={2000}
          disabled={save.pending}
        />
      </Field>
      {save.error ? <p role="alert">{save.error}</p> : null}
      {save.errorStatus === 401 ? (
        <a href={signInHref} target="_blank" rel="noreferrer">
          Sign in again in a new tab
        </a>
      ) : null}
      {save.saved ? <p role="status">Message sent to the organizer.</p> : null}
      <button className="contribution-button" disabled={save.pending}>
        {save.pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
function OrganizerInbox({
  client,
  id,
}: {
  client: ContributionsApi;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="contribution-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="contribution-button contribution-button--secondary">
        Private messages
      </summary>
      {open ? <OrganizerMessages client={client} id={id} /> : null}
    </details>
  );
}
function OrganizerMessages({
  client,
  id,
}: {
  client: ContributionsApi;
  id: string;
}) {
  const load = useCallback(() => client.messages(id), [client, id]);
  const { data, reload } = useContributionRead(load);
  return (
    <>
      <ViewState data={data}>
        {(messages) =>
          messages.length ? (
            <ul className="contribution-timeline">
              {messages.map((entry) => (
                <li key={entry.id}>
                  <p className="contribution-prose">{entry.message}</p>
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p>No messages yet.</p>
          )
        }
      </ViewState>
      {data.status === "error" ? (
        <button type="button" onClick={reload}>
          Try again
        </button>
      ) : null}
    </>
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
