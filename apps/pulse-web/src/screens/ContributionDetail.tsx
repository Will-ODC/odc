import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type { PulseApi } from "../api/types.js";
import {
  contributionsApi,
  ContributionsError,
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
import { useMyVotes, useVotesFollowSession } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { ViewState } from "../components/ViewState.js";
import { Field } from "../components/Field.js";
import { Button } from "../components/Button.js";
import { Choice } from "../components/Choice.js";
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
import { readableDate } from "../flow/conversation.js";
import "./Contributions.css";

export function ContributionDetail({
  api,
  id,
  client = contributionsApi,
  focusHeading = false,
}: {
  api: PulseApi;
  id: string;
  client?: ContributionsApi;
  /**
   * Move focus to the title once it loads: the page someone lands on after
   * publishing, where focus would otherwise be left on nothing.
   */
  focusHeading?: boolean;
}) {
  const mine = useMyVotes(api);
  const [railRetried, setRailRetried] = useState(false);
  const votes = useVotesFollowSession(mine);
  const clearVotes = () => {
    setRailRetried(false);
    votes.cleared();
  };
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: clearVotes,
    onForgotten: clearVotes,
    recheckSignedIn: true,
  });
  type WriteForm = "participation" | "message" | "update";
  const [refusals, setRefusals] = useState({
    participation: 0,
    message: 0,
    update: 0,
  });
  async function write<T>(form: WriteForm, send: () => Promise<T>): Promise<T> {
    const submitted = {
      owner: drafts.owner,
      generation: drafts.generation,
      refusal: refusals[form],
      id,
    };
    try {
      return await send();
    } catch (error) {
      if (
        error instanceof ContributionsError &&
        error.status === 409 &&
        error.code === "account_changed"
      ) {
        const mounted = mountedDrafts.current;
        if (
          mounted &&
          mounted.forms[form] &&
          mounted.owner === submitted.owner &&
          mounted.generation === submitted.generation &&
          mounted.refusals[form] === submitted.refusal &&
          mounted.id === submitted.id
        )
          setRefusals((current) => ({ ...current, [form]: current[form] + 1 }));
        window.dispatchEvent(new Event("focus"));
      }
      throw error;
    }
  }
  const accountId = session.status === "signedIn" ? session.me.id : null;
  // Read the votes again once someone is signed in after they were cleared.
  useEffect(() => votes.signedInAs(accountId));
  // Whose drafts the forms hold. A new generation remounts the forms empty:
  // after someone chooses to sign out, or when a different account signs in.
  // An expired session keeps them, so signing in again as the same person
  // (in a new tab) can still send what was written.
  const [drafts, setDrafts] = useState<{
    owner: string | null;
    generation: number;
  }>({ owner: accountId, generation: 0 });
  if (accountId !== null && drafts.owner !== accountId)
    setDrafts({
      owner: accountId,
      generation: drafts.generation + (drafts.owner === null ? 0 : 1),
    });
  else if (
    session.status === "signedOut" &&
    session.ended !== "expired" &&
    drafts.owner !== null
  )
    setDrafts({ owner: null, generation: drafts.generation + 1 });
  const access: Access =
    session.status === "signedIn"
      ? "signedIn"
      : session.status === "signedOut" &&
          session.ended === "expired" &&
          drafts.owner !== null
        ? "expired"
        : session.status === "loading"
          ? "loading"
          : "signedOut";
  const load = useCallback(async () => {
    const detail = await client.detail(id);
    return { ...detail, accountId };
  }, [client, id, accountId]);
  // Keep the page while it reloads for a new account: the open message box
  // and the scroll position must survive signing in from another tab.
  // `canManage` below still needs the reloaded answer for this account.
  const { data, reload, replace, refreshError } = useContributionRead(load, {
    keepReady: true,
  });
  const canManage =
    accountId !== null &&
    data.status === "ready" &&
    data.value.accountId === accountId &&
    data.value.canManage;
  // The account last seen managing this record. If its session expires while
  // an update is being written, the update form stays with its draft (the
  // private inbox does not: that needs a live session to show).
  const [managedBy, setManagedBy] = useState<string | null>(null);
  if (canManage && managedBy !== accountId) setManagedBy(accountId);
  else if (
    !canManage &&
    managedBy !== null &&
    accountId !== null &&
    data.status === "ready" &&
    data.value.accountId === accountId
  )
    setManagedBy(null);
  // Keep it too while the page reloads for that same account after signing
  // in again, until the reloaded answer says whether it may still manage.
  const canUpdate =
    canManage ||
    (managedBy !== null &&
      managedBy === drafts.owner &&
      (access === "expired" ||
        (access === "signedIn" &&
          data.status === "ready" &&
          data.value.accountId !== accountId)));
  // A late refusal belongs to the submitting draft, even if another account
  // has already remounted this form and started writing. Track committed forms
  // so an old request cannot clear a replacement draft or announce its error.
  const mountedDrafts = useRef<{
    owner: string | null;
    generation: number;
    refusals: typeof refusals;
    id: string;
    forms: Record<WriteForm, boolean>;
  } | null>(null);
  useLayoutEffect(() => {
    mountedDrafts.current = {
      ...drafts,
      refusals,
      id,
      forms: {
        participation: data.status === "ready",
        message: data.status === "ready" && !canManage,
        update: data.status === "ready" && canUpdate,
      },
    };
    return () => {
      mountedDrafts.current = null;
    };
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const headingFocused = useRef(false);
  const ready = data.status === "ready";
  useEffect(() => {
    if (!focusHeading || !ready || headingFocused.current) return;
    headingFocused.current = true;
    heading.current?.focus();
  }, [focusHeading, ready]);
  // "Try again" on the refresh banner: once it works the banner (and the
  // button that had focus) goes, so put focus on the title instead.
  const retrying = useRef(false);
  useEffect(() => {
    if (!retrying.current || refreshError) return;
    retrying.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) heading.current?.focus();
  }, [refreshError]);
  function changed(contribution: Contribution) {
    if (data.status === "ready") replace({ ...data.value, contribution });
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
        {data.status === "ready" && refreshError ? (
          <div className="contribution-refresh" role="alert">
            <p className="contribution-error">
              This page could not be brought up to date. {refreshError}
            </p>
            <Button
              variant="secondary"
              size="small"
              className="contribution-retry"
              type="button"
              onClick={() => {
                retrying.current = true;
                reload();
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        <ViewState data={data}>
          {({ contribution: item }) => (
            <>
              <header className="contribution-detail-heading">
                <div className="contribution-meta">
                  <span>{contributionKinds[item.kind]}</span>
                  <span>{contributionStatuses[item.status]}</span>
                </div>
                <h1 ref={heading} tabIndex={-1}>
                  {item.title}
                </h1>
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
                {refusals.participation ? (
                  <p role="alert" className="contribution-error">
                    Your account changed, so this wasn&apos;t sent.
                  </p>
                ) : null}
                <ParticipationForm
                  key={`${item.id}:${drafts.generation}:${refusals.participation}`}
                  access={access}
                  accountId={accountId ?? ""}
                  write={(send) => write("participation", send)}
                  client={client}
                  item={item}
                  changed={changed}
                />
              </section>
              <section className="contribution-section">
                {refusals.message ? (
                  <p role="alert" className="contribution-error">
                    Your account changed, so this wasn&apos;t sent.
                  </p>
                ) : null}
                {canManage ? (
                  <OrganizerInbox key={item.id} client={client} id={item.id} />
                ) : canUpdate ? (
                  // The organizer, while their sign-in has ended: their inbox
                  // needs a live session, but this is still their post, so
                  // no "Message the organizer" form in its place.
                  <p className="contribution-note">
                    Sign in again to read your private messages.
                  </p>
                ) : (
                  <details className="contribution-disclosure">
                    <summary className="contribution-button contribution-button--secondary">
                      Message the organizer
                    </summary>
                    <MessageForm
                      key={`${item.id}:${drafts.generation}:${refusals.message}`}
                      access={access}
                      accountId={accountId ?? ""}
                      write={(send) => write("message", send)}
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
                          <time dateTime={entry.createdAt}>
                            {readableDate(new Date(entry.createdAt))}
                          </time>
                        </div>
                        <p className="contribution-prose">{entry.message}</p>
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
                            {readableDate(new Date(entry.createdAt))}
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
                {refusals.update ? (
                  <p role="alert" className="contribution-error">
                    Your account changed, so this wasn&apos;t sent.
                  </p>
                ) : null}
                {canUpdate ? (
                  <details className="contribution-disclosure">
                    <summary className="contribution-button contribution-button--secondary">
                      Post an update
                    </summary>
                    <UpdateForm
                      key={`${item.id}:${drafts.generation}:${refusals.update}`}
                      access={access}
                      accountId={accountId ?? ""}
                      write={(send) => write("update", send)}
                      client={client}
                      item={item}
                      changed={changed}
                    />
                  </details>
                ) : null}
              </section>
            </>
          )}
        </ViewState>
        {data.status === "error" && data.statusCode !== 404 ? (
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
/**
 * Whether the forms may be filled in. "expired": the session ran out while
 * someone may have been writing; the form stays, with a way to sign in again.
 */
type Access = "loading" | "signedIn" | "expired" | "signedOut";

/**
 * Says the session ended and offers the new-tab sign-in; the form stays.
 * Only one copy on the page announces itself, so a screen reader hears it once.
 */
function SignInAgain({
  href,
  announce = true,
}: {
  href: string;
  announce?: boolean;
}) {
  return (
    <p
      className="contribution-expired"
      {...(announce ? { role: "status" } : {})}
    >
      Your sign-in has ended. What you wrote stays here.{" "}
      <a href={href} target="_blank" rel="noreferrer">
        Sign in again in a new tab
      </a>{" "}
      to send it.
    </p>
  );
}

/**
 * After a send, the button is disabled while it is pending, so the browser
 * drops keyboard focus to the page. Put it on the outcome instead (the
 * thank-you or the error), unless the person has moved on to something else.
 * Also forgets a "sign in" error once signing in again has fixed it.
 */
function useSendOutcome(
  save: {
    saved: boolean;
    failure: unknown;
    errorStatus?: number | undefined;
    clearFailure: () => void;
  },
  access: Access,
) {
  const status = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (save.saved && focusLost()) status.current?.focus();
  }, [save.saved]);
  useEffect(() => {
    if (save.failure && focusLost()) alert.current?.focus();
  }, [save.failure]);
  const before = useRef(access);
  const { errorStatus, clearFailure } = save;
  useEffect(() => {
    if (
      before.current === "expired" &&
      access === "signedIn" &&
      errorStatus === 401
    )
      clearFailure();
    before.current = access;
  }, [access, errorStatus, clearFailure]);
  return { status, alert };
}
function focusLost() {
  const active = document.activeElement;
  return active === null || active === document.body;
}
/**
 * A form's change handler that takes back a field's complaint as soon as the
 * person has fixed it, rather than leaving it red until the next send.
 */
function clearWhenFixed<K extends string>(
  problems: Partial<Record<K, string>>,
  setProblems: (next: Partial<Record<K, string>>) => void,
  fixed: (name: K, field: HTMLInputElement | HTMLTextAreaElement) => boolean,
) {
  return (event: FormEvent<HTMLFormElement>) => {
    const field = event.target;
    if (!(
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    ))
      return;
    const name = field.name as K;
    if (problems[name] === undefined || !fixed(name, field)) return;
    const next = { ...problems };
    delete next[name];
    setProblems(next);
  };
}
/** Move focus to a field the form refused, by id. */
function focusField(id: string) {
  document.getElementById(id)?.focus();
}
/** A full http(s) link, the only kind the API takes as evidence. */
function isWebLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const participationLabels: Record<ParticipationKind, string> = {
  help: "Offer of help",
  pledge: "Pledge",
  report: "Reported contribution",
};
function MessageForm({
  access,
  accountId,
  write,
  client,
  id,
}: {
  access: Access;
  accountId: string;
  write: <T>(send: () => Promise<T>) => Promise<T>;
  client: ContributionsApi;
  id: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useContributionSave<string>(
    (message, key) =>
      write(() => client.sendMessage(id, message, key, accountId)),
    () => formRef.current?.reset(),
  );
  const outcome = useSendOutcome(save, access);
  const [problem, setProblem] = useState<string>();
  const signInHref = `/sign-in?contribution=${encodeURIComponent(id)}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = String(
      new FormData(event.currentTarget).get("message") ?? "",
    ).trim();
    if (!message) {
      setProblem("Write a message to send.");
      focusField("contribution-message");
      return;
    }
    setProblem(undefined);
    void save.submit(message);
  }
  if (access === "loading") return <p role="status">Loading…</p>;
  if (access === "signedOut")
    return (
      <a href={signInHref} target="_blank" rel="noreferrer">
        Sign in to send a message
      </a>
    );
  return (
    <form
      className="contribution-form"
      ref={formRef}
      onSubmit={submit}
      onChange={clearWhenFixed<"message">(
        problem === undefined ? {} : { message: problem },
        (next) => setProblem(next.message),
        (_name, field) => field.value.trim() !== "",
      )}
      noValidate
    >
      {access === "expired" ? (
        // The offer form above already announces the expiry.
        <SignInAgain href={signInHref} announce={false} />
      ) : null}
      <p className="contribution-note">
        Only the organizer can read this. They can&apos;t reply here.
      </p>
      <Field
        id="contribution-message"
        label="Private message"
        problem={problem}
      >
        {(described) => (
          <textarea
            id="contribution-message"
            className="field__control"
            aria-invalid={problem !== undefined || undefined}
            name="message"
            rows={3}
            maxLength={2000}
            disabled={save.pending}
            {...described}
          />
        )}
      </Field>
      {save.error ? (
        <p
          role="alert"
          className="contribution-error"
          ref={outcome.alert}
          tabIndex={-1}
        >
          {save.error}
        </p>
      ) : null}
      {save.errorStatus === 401 && access !== "expired" ? (
        <a href={signInHref} target="_blank" rel="noreferrer">
          Sign in again in a new tab
        </a>
      ) : null}
      {save.saved ? (
        <p role="status" ref={outcome.status} tabIndex={-1}>
          Message sent to the organizer.
        </p>
      ) : null}
      <Button variant="primary" disabled={save.pending}>
        {save.pending ? "Sending…" : "Send message"}
      </Button>
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
                  <div className="contribution-meta">
                    <time dateTime={entry.createdAt}>
                      {readableDate(new Date(entry.createdAt))}
                    </time>
                  </div>
                  <p className="contribution-prose">{entry.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No messages yet.</p>
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
    </>
  );
}
function UpdateForm({
  access,
  accountId,
  write,
  client,
  item,
  changed,
}: {
  access: Access;
  accountId: string;
  write: <T>(send: () => Promise<T>) => Promise<T>;
  client: ContributionsApi;
  item: Contribution;
  changed: (item: Contribution) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled from the record: after a publish the select shows the status
  // just published, never the one the page loaded with, so the next update
  // cannot quietly reopen the record.
  const [status, setStatus] = useState(item.status);
  const [shown, setShown] = useState(item.status);
  if (shown !== item.status) {
    setShown(item.status);
    setStatus(item.status);
  }
  const save = useContributionSave<UpdateInput>(
    async (input, key) =>
      changed(await write(() => client.update(item.id, input, key, accountId))),
    // Clear what was written, not the status: `reset()` would put the
    // select back to the status this form first rendered with.
    () => clearWritten(formRef.current, ["message", "evidence"]),
  );
  const outcome = useSendOutcome(save, access);
  const [problems, setProblems] = useState<{
    message?: string;
    evidence?: string;
    confirm?: string;
  }>({});
  const signInHref = `/sign-in?contribution=${encodeURIComponent(item.id)}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const evidenceUrl = String(form.get("evidence") ?? "").trim();
    const found = {
      ...(String(form.get("message") ?? "").trim()
        ? {}
        : { message: "Write the progress update." }),
      ...(evidenceUrl && !isWebLink(evidenceUrl)
        ? { evidence: "Enter a full link, starting with https://" }
        : {}),
      ...(form.get("confirm")
        ? {}
        : { confirm: "Confirm this status and update may be published." }),
    };
    setProblems(found);
    const first = (["message", "evidence", "confirm"] as const).find(
      (name) => found[name],
    );
    if (first) {
      focusField(`update-${first}`);
      return;
    }
    void save.submit({
      message: String(form.get("message") ?? "").trim(),
      status,
      ...(evidenceUrl ? { evidenceUrl } : {}),
    });
  }
  return (
    <form
      className="contribution-form contribution-update"
      ref={formRef}
      onSubmit={submit}
      onChange={clearWhenFixed<"message" | "evidence" | "confirm">(
        problems,
        setProblems,
        (name, field) =>
          name === "confirm"
            ? field instanceof HTMLInputElement && field.checked
            : name === "evidence"
              ? field.value.trim() === "" || isWebLink(field.value.trim())
              : field.value.trim() !== "",
      )}
      noValidate
    >
      {access === "expired" ? <SignInAgain href={signInHref} /> : null}
      <fieldset disabled={save.pending}>
        <Field id="update-status" label="Current status" problem={undefined}>
          {(described) => (
            <select
              id="update-status"
              className="field__control"
              name="status"
              value={status}
              onChange={(event) =>
                setStatus(event.currentTarget.value as ContributionStatus)
              }
              {...described}
            >
              {Object.entries(contributionStatuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          id="update-message"
          label="Progress update"
          problem={problems.message}
        >
          {(described) => (
            <textarea
              id="update-message"
              className="field__control"
              aria-invalid={problems.message !== undefined || undefined}
              name="message"
              maxLength={2000}
              rows={3}
              {...described}
            />
          )}
        </Field>
        <Field
          id="update-evidence"
          label="Evidence link (optional)"
          problem={problems.evidence}
        >
          {(described) => (
            <input
              id="update-evidence"
              className="field__control"
              aria-invalid={problems.evidence !== undefined || undefined}
              name="evidence"
              type="url"
              maxLength={2000}
              placeholder="https://"
              {...described}
            />
          )}
        </Field>
        <label className="contribution-check">
          <input
            type="checkbox"
            id="update-confirm"
            name="confirm"
            aria-invalid={problems.confirm !== undefined || undefined}
            {...(problems.confirm
              ? { "aria-describedby": "update-confirm-problem" }
              : {})}
          />
          I confirm this status and update may be published.
        </label>
        {problems.confirm ? (
          <p className="field__problem" id="update-confirm-problem">
            {problems.confirm}
          </p>
        ) : null}
      </fieldset>
      {save.error ? (
        <p
          role="alert"
          className="contribution-error"
          ref={outcome.alert}
          tabIndex={-1}
        >
          {save.error}
        </p>
      ) : null}
      {save.errorStatus === 401 && access !== "expired" ? (
        <a href={signInHref} target="_blank" rel="noreferrer">
          Sign in again in a new tab
        </a>
      ) : null}
      {save.saved ? (
        <p role="status" ref={outcome.status} tabIndex={-1}>
          Your update has been published.
        </p>
      ) : null}
      <Button variant="primary" disabled={save.pending}>
        {save.pending ? "Publishing…" : "Publish update"}
      </Button>
    </form>
  );
}

type Offer = Exclude<ParticipationKind, "report">;
const offerLabels: Record<
  Offer,
  { choice: string; field: string; send: string }
> = {
  help: {
    choice: "Offer help",
    field: "How you can help",
    send: "Offer help",
  },
  pledge: {
    choice: "Make a pledge",
    field: "What you pledge",
    send: "Make pledge",
  },
};

/** Offer help or pledge: the participation kinds open records accept. */
function ParticipationForm({
  access,
  accountId,
  write,
  client,
  item,
  changed,
}: {
  access: Access;
  accountId: string;
  write: <T>(send: () => Promise<T>) => Promise<T>;
  client: ContributionsApi;
  item: Contribution;
  changed: (item: Contribution) => void;
}) {
  const [kind, setKind] = useState<Offer>("help");
  const formRef = useRef<HTMLFormElement>(null);
  const save = useContributionSave<{
    displayName: string;
    kind: Offer;
    message: string;
  }>(
    async (input, key) =>
      changed(
        await write(() => client.participate(item.id, input, key, accountId)),
      ),
    // The name and the chosen kind stay for a second entry; `reset()` would
    // also clear the controlled kind behind React's back.
    () => clearWritten(formRef.current, ["message"]),
  );
  const outcome = useSendOutcome(save, access);
  const [problems, setProblems] = useState<{
    displayName?: string;
    message?: string;
  }>({});
  const signInHref = `/sign-in?contribution=${encodeURIComponent(item.id)}`;
  const heading = <h2 id="participate-heading">Offer help or pledge</h2>;
  if (item.status === "completed" || item.status === "cancelled")
    return (
      <>
        {heading}
        <p className="contribution-note">
          This contribution is closed to new offers of help and pledges.
        </p>
      </>
    );
  if (access === "loading")
    return (
      <>
        {heading}
        <p role="status">Loading…</p>
      </>
    );
  if (access === "signedOut")
    return (
      <>
        {heading}
        <a href={signInHref} target="_blank" rel="noreferrer">
          Sign in to offer help or make a pledge
        </a>
      </>
    );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const found = {
      ...(displayName ? {} : { displayName: "Enter the name to show." }),
      ...(message
        ? {}
        : {
            message:
              kind === "help"
                ? "Say how you can help."
                : "Say what you pledge.",
          }),
    };
    setProblems(found);
    if (found.displayName) return focusField("participation-name");
    if (found.message) return focusField("participation-message");
    void save.submit({ displayName, kind, message });
  }
  return (
    <>
      {heading}
      {access === "expired" ? <SignInAgain href={signInHref} /> : null}
      <form
        className="contribution-form"
        ref={formRef}
        onSubmit={submit}
        onChange={clearWhenFixed<"displayName" | "message">(
          problems,
          setProblems,
          (_name, field) => field.value.trim() !== "",
        )}
        aria-labelledby="participate-heading"
        noValidate
      >
        <fieldset disabled={save.pending}>
          <legend className="visually-hidden">What you are offering</legend>
          <div className="choice-list">
            {(Object.keys(offerLabels) as Offer[]).map((value) => (
              <Choice
                key={value}
                name="participation-kind"
                value={value}
                checked={kind === value}
                onPick={() => {
                  setKind(value);
                  save.clearSaved();
                }}
              >
                {offerLabels[value].choice}
              </Choice>
            ))}
          </div>
          <Field
            id="participation-name"
            label="Public name"
            hint="Shown with your entry on this page."
            problem={problems.displayName}
          >
            {(described) => (
              <input
                id="participation-name"
                className="field__control"
                aria-invalid={problems.displayName !== undefined || undefined}
                name="displayName"
                maxLength={80}
                autoComplete="nickname"
                {...described}
              />
            )}
          </Field>
          <Field
            id="participation-message"
            label={offerLabels[kind].field}
            problem={problems.message}
          >
            {(described) => (
              <textarea
                id="participation-message"
                className="field__control"
                aria-invalid={problems.message !== undefined || undefined}
                name="message"
                maxLength={2000}
                rows={3}
                {...described}
              />
            )}
          </Field>
        </fieldset>
        {save.error ? (
          <p
            role="alert"
            className="contribution-error"
            ref={outcome.alert}
            tabIndex={-1}
          >
            {save.error}
          </p>
        ) : null}
        {save.errorStatus === 401 && access !== "expired" ? (
          <a href={signInHref} target="_blank" rel="noreferrer">
            Sign in again in a new tab
          </a>
        ) : null}
        {save.saved ? (
          <p role="status" ref={outcome.status} tabIndex={-1}>
            Thank you. Your entry is on this page.
          </p>
        ) : null}
        <Button variant="primary" disabled={save.pending}>
          {save.pending ? "Sending…" : offerLabels[kind].send}
        </Button>
      </form>
    </>
  );
}

/** Empty the named text fields and untick confirmations after a save. */
function clearWritten(form: HTMLFormElement | null, names: string[]) {
  if (!form) return;
  for (const name of names) {
    const field = form.elements.namedItem(name);
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement
    )
      field.value = "";
  }
  for (const confirm of form.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  ))
    confirm.checked = false;
}
