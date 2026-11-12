import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, type MemberProfile, type PulseApi } from "../api/types.js";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Choice } from "../components/Choice.js";
import { CopyLink } from "../components/CopyLink.js";
import { Field } from "../components/Field.js";
import { PageBanner } from "../components/PageBanner.js";
import { ViewState } from "../components/ViewState.js";
import { bioProblem, nameProblem } from "../flow/profile-name.js";
import { pathOf } from "../flow/route.js";
import { useOwnerProfile } from "../hooks/use-owner-profile.js";
import "./Profile.css";

export function ProfileEditor({ api }: { api: PulseApi }) {
  const { state, retry, save } = useOwnerProfile(api);
  const href = pathOf({ kind: "profileEditor" });
  return (
    <AppShell banner={<PageBanner api={api} currentHref={href} />}>
      <article className="profile">
        <h1 className="profile__title">Your profile</h1>
        <p className="profile__lede">
          Choose what anyone with your profile link can see. Your email and
          votes stay private.
        </p>
        <ViewState data={state} variant="compact">
          {(profile) => <ProfileForm initial={profile} save={save} />}
        </ViewState>
        {state.status === "error" ? (
          <Button variant="secondary" type="button" onClick={retry}>
            Try again
          </Button>
        ) : null}
        {state.status === "empty" ? (
          <Button
            variant="primary"
            href={pathOf({
              kind: "signIn",
              returnTo: { kind: "profileEditor" },
            })}
          >
            Sign in
          </Button>
        ) : null}
      </article>
    </AppShell>
  );
}

function ProfileForm({
  initial,
  save,
}: {
  initial: MemberProfile | null;
  save: (request: {
    displayName: string;
    bio: string;
    visible: boolean;
  }) => Promise<MemberProfile>;
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
    if (nameIssue || bioIssue || sending.current) return;
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
