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
        <ViewState data={state}>
          {(profile) => <ProfileForm initial={profile} save={save} />}
        </ViewState>
        {state.status === "error" ? (
          <Button variant="secondary" type="button" onClick={retry}>
            Try again
          </Button>
        ) : null}
        {state.status === "empty" ? (
          <Button variant="primary" href="/sign-in">
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
  const [progress, setProgress] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; profile: MemberProfile }
    | { status: "error"; message: string }
  >(initial ? { status: "saved", profile: initial } : { status: "idle" });
  const sending = useRef(false);
  const id = useId();
  useEffect(() => {
    setName(initial?.displayName ?? "");
    setBio(initial?.bio ?? "");
    setVisible(initial?.visible ?? true);
    setProgress(
      initial ? { status: "saved", profile: initial } : { status: "idle" },
    );
  }, [initial]);
  const nameIssue = problem(name, 80, false);
  const bioIssue = problem(bio, 280, true);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setShown({ name: true, bio: true });
    if (nameIssue || bioIssue || sending.current) return;
    sending.current = true;
    setProgress({ status: "saving" });
    try {
      const profile = await save({ displayName: name, bio, visible });
      setName(profile.displayName);
      setBio(profile.bio);
      setProgress({ status: "saved", profile });
    } catch (error) {
      setProgress({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't save your profile. Check your connection and try again.",
      });
    } finally {
      sending.current = false;
    }
  }

  const saved = progress.status === "saved" ? progress.profile : initial;
  return (
    <form className="profile__form" onSubmit={submit} noValidate>
      <fieldset
        className="profile__fields"
        disabled={progress.status === "saving"}
      >
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
              aria-invalid={shown.name && nameIssue ? true : undefined}
              onChange={(event) => setName(event.target.value)}
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
              aria-invalid={shown.bio && bioIssue ? true : undefined}
              onChange={(event) => setBio(event.target.value)}
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
            onPick={() => setVisible(true)}
          >
            Public — anyone with the link
          </Choice>
          <Choice
            name={`${id}-visibility`}
            value="hidden"
            checked={!visible}
            onPick={() => setVisible(false)}
          >
            Hidden — the link shows unavailable
          </Choice>
        </fieldset>
      </fieldset>
      <Button
        variant="primary"
        type="submit"
        disabled={progress.status === "saving"}
      >
        {progress.status === "saving" ? "Saving…" : "Save profile"}
      </Button>
      <p className="profile__status" role="status" aria-live="polite">
        {progress.status === "saved"
          ? progress.profile.visible
            ? "Your public profile is ready to share."
            : "Your profile is hidden."
          : progress.status === "error"
            ? progress.message
            : ""}
      </p>
      {saved?.visible ? (
        <CopyLink
          url={new URL(`/u/${saved.publicId}`, globalThis.location.origin).href}
          question={`profile for ${saved.displayName}`}
        />
      ) : null}
    </form>
  );
}

function problem(
  value: string,
  limit: number,
  empty: boolean,
): string | undefined {
  const length = [...value.trim()].length;
  if (!empty && length === 0) return "Enter a display name.";
  if (length > limit) return `Use ${limit} characters or fewer.`;
  return undefined;
}
