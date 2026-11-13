import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, type MemberProfile, type PulseApi } from "../api/types.js";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Choice } from "../components/Choice.js";
import { CopyLink } from "../components/CopyLink.js";
import { Field } from "../components/Field.js";
import { SiteBanner } from "../components/SiteBanner.js";
import { useMyVotes, useVotesFollowSession } from "../hooks/use-my-votes.js";
import { useSession } from "../hooks/use-session.js";
import { ViewState } from "../components/ViewState.js";
import { bioProblem, nameProblem } from "../flow/profile-name.js";
import { pathOf } from "../flow/route.js";
import { useOwnerProfile } from "../hooks/use-owner-profile.js";
import "./Profile.css";
import "./Contributions.css";

export function ProfileEditor({ api }: { api: PulseApi }) {
  const [generation, setGeneration] = useState(0);
  const accountChanged = useCallback(
    () => setGeneration((value) => value + 1),
    [],
  );
  return (
    <ProfileEditorSession
      key={generation}
      api={api}
      accountChanged={generation > 0}
      onAccountChanged={accountChanged}
    />
  );
}

function ProfileEditorSession({
  api,
  accountChanged,
  onAccountChanged,
}: {
  api: PulseApi;
  accountChanged: boolean;
  onAccountChanged: () => void;
}) {
  const mine = useMyVotes(api);
  const votes = useVotesFollowSession(mine);
  const { session, progress, signOut, dismiss } = useSession(api, {
    onSignedOut: votes.cleared,
    onForgotten: votes.cleared,
    recheckSignedIn: true,
  });
  const accountId = session.status === "signedIn" ? session.me.id : null;
  useEffect(() => votes.signedInAs(accountId));
  const [draft, setDraft] = useState({ owner: accountId, generation: 0 });
  // An expiry is recoverable only by the same account. A deliberate sign-out
  // or another account gives the form a new lifetime, including pending work.
  if (accountId !== null && accountId !== draft.owner)
    setDraft({ owner: accountId, generation: draft.generation + 1 });
  else if (
    session.status === "signedOut" &&
    session.ended !== "expired" &&
    draft.owner !== null
  )
    setDraft({ owner: null, generation: draft.generation + 1 });
  const expired = session.status === "signedOut" && session.ended === "expired";
  const href = pathOf({ kind: "profileEditor" });
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
          currentHref={href}
        />
      }
    >
      <article className="profile">
        <h1 className="profile__title">Your profile</h1>
        <p className="profile__lede">
          Choose what anyone with your profile link can see. Your email and
          votes stay private.
        </p>
        {accountChanged ? (
          <p role="status">
            Your account changed. Your unsaved profile was cleared.
          </p>
        ) : null}
        {draft.owner !== null ? (
          <OwnerEditor
            key={draft.generation}
            api={api}
            expired={expired}
            ownerAccountId={draft.owner}
            onAccountChanged={onAccountChanged}
          />
        ) : session.status === "loading" ? (
          <ViewState data={{ status: "loading" }}>{() => null}</ViewState>
        ) : (
          <ProfileSignIn />
        )}
      </article>
    </AppShell>
  );
}

function ProfileSignIn() {
  return (
    <>
      <ViewState
        data={{
          status: "empty",
          message: "Sign in to create or change your public profile.",
        }}
        variant="compact"
      >
        {() => null}
      </ViewState>
      <Button
        variant="primary"
        href={pathOf({ kind: "signIn", returnTo: { kind: "profileEditor" } })}
      >
        Sign in
      </Button>
    </>
  );
}

function OwnerEditor({
  api,
  expired,
  ownerAccountId,
  onAccountChanged,
}: {
  api: PulseApi;
  expired: boolean;
  ownerAccountId: string;
  onAccountChanged: () => void;
}) {
  const { state, retry, save } = useOwnerProfile(
    api,
    !expired,
    ownerAccountId,
    onAccountChanged,
  );
  return (
    <>
      <ViewState data={state} variant="compact">
        {(profile) => (
          <ProfileForm initial={profile} save={save} expired={expired} />
        )}
      </ViewState>
      {state.status === "error" ? (
        <Button variant="secondary" type="button" onClick={retry}>
          Try again
        </Button>
      ) : null}
      {state.status === "empty" ? <ProfileSignIn /> : null}
    </>
  );
}

function ProfileForm({
  initial,
  save,
  expired,
}: {
  initial: MemberProfile | null;
  expired: boolean;
  save: (request: {
    displayName: string;
    bio: string;
    visible: boolean;
  }) => Promise<MemberProfile | undefined>;
}) {
  const [name, setName] = useState(initial?.displayName ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [visible, setVisible] = useState(initial?.visible ?? true);
  const [shown, setShown] = useState({ name: false, bio: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const sending = useRef(false);
  const id = useId();
  useEffect(() => {
    setName(initial?.displayName ?? "");
    setBio(initial?.bio ?? "");
    setVisible(initial?.visible ?? true);
  }, [initial]);
  const nameIssue = nameProblem(name);
  const bioIssue = bioProblem(bio);

  // A save error is about what was sent. Once the person changes a field it no
  // longer describes the form, so it goes rather than sit beside a new one.
  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      if (sending.current) return;
      set(value);
      setSaveError(undefined);
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setShown({ name: true, bio: true });
    if (expired || nameIssue || bioIssue || sending.current) return;
    sending.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      await save({ displayName: name, bio, visible });
    } catch (error) {
      setSaveError(saveMessage(error));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  // The status describes only what is saved. Choosing Public is not sharing
  // until Save, so a changed form says so instead of claiming either state.
  const changed =
    initial !== null &&
    (name.trim() !== initial.displayName ||
      bio.trim() !== initial.bio ||
      visible !== initial.visible);
  const status = saveError
    ? saveError
    : saving
      ? "Saving…"
      : changed
        ? "Not saved yet."
        : initial === null
          ? ""
          : initial.visible
            ? "Your public profile is ready to share."
            : "Your profile is hidden.";
  return (
    <form className="profile__form" onSubmit={submit} noValidate>
      {expired ? (
        <p className="contribution-expired" role="status">
          Your sign-in has ended. What you wrote stays here.{" "}
          <a href="/sign-in?next=profile" target="_blank" rel="noreferrer">
            Sign in again in a new tab
          </a>{" "}
          to save it.
        </p>
      ) : null}
      {/*
        Nothing here is disabled while saving: disabling the focused control
        drops focus to the top of the page. The Save button is aria-disabled
        and `sending` refuses a second submit instead.
      */}
      <div className="profile__fields">
        <Field
          id={`${id}-name`}
          label="Public display name"
          hint="1–80 characters. Display names do not have to be unique."
          problem={shown.name ? nameIssue : undefined}
        >
          {(described) => (
            <input
              {...described}
              className="field__control"
              id={`${id}-name`}
              value={name}
              readOnly={saving}
              aria-invalid={shown.name && nameIssue ? true : undefined}
              onChange={(event) => edit(setName)(event.target.value)}
              onBlur={() => setShown((value) => ({ ...value, name: true }))}
            />
          )}
        </Field>
        <Field
          id={`${id}-bio`}
          label="Bio (optional)"
          hint="Up to 280 characters. Plain text only."
          problem={shown.bio ? bioIssue : undefined}
        >
          {(described) => (
            <textarea
              {...described}
              className="field__control profile__bio-field"
              id={`${id}-bio`}
              value={bio}
              readOnly={saving}
              aria-invalid={shown.bio && bioIssue ? true : undefined}
              onChange={(event) => edit(setBio)(event.target.value)}
              onBlur={() => setShown((value) => ({ ...value, bio: true }))}
            />
          )}
        </Field>
        <fieldset className="profile__visibility">
          <legend>Who can see it?</legend>
          <Choice
            name={`${id}-visibility`}
            value="public"
            checked={visible}
            onPick={() => edit(setVisible)(true)}
          >
            Public — anyone with the link
          </Choice>
          <Choice
            name={`${id}-visibility`}
            value="hidden"
            checked={!visible}
            onPick={() => edit(setVisible)(false)}
          >
            Hidden — the link shows unavailable
          </Choice>
        </fieldset>
      </div>
      <Button
        variant="primary"
        type="submit"
        disabled={expired}
        aria-disabled={saving || undefined}
      >
        {saving ? "Saving…" : "Save profile"}
      </Button>
      <p
        className={`profile__status${saveError ? " profile__status--error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
      {initial?.visible ? (
        <>
          <a className="profile__view" href={`/u/${initial.publicId}`}>
            View your profile
          </a>
          <CopyLink
            url={
              new URL(`/u/${initial.publicId}`, globalThis.location.origin).href
            }
            question={`profile for ${initial.displayName}`}
          />
        </>
      ) : null}
    </form>
  );
}

/** Plain words for a refused save; the server's own sentence is for developers. */
function saveMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return "We couldn't save that name or bio. Check them and try again.";
    if (error.status === 401)
      return "You're signed out. Sign in again to save your profile.";
    if (error.status === 429)
      return "Too many saves in a row. Wait a moment and try again.";
  }
  return "We couldn't save your profile. Check your connection and try again.";
}
