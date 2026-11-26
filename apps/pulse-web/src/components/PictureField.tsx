import { useId, useLayoutEffect, useRef } from "react";
import { PICTURE_TYPES, pictureSize } from "../hooks/picture-upload-errors.js";
import {
  UPLOADING_PICTURE,
  type PictureFieldController,
} from "../hooks/use-picture-field.js";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import { ViewState } from "./ViewState.js";
import "./PictureField.css";

const hint =
  "One picture. JPEG, PNG or WebP, up to 10 MB. Pulse removes location and camera details from it.";
const descriptionHint =
  "Required with a picture. Say what it shows, for people who cannot see it. Up to 300 characters.";
const ready = { status: "ready", value: null } as const;

export function PictureField({ field }: { field: PictureFieldController }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const { focus, problem, selection } = field;

  useLayoutEffect(() => {
    if (focus?.target === "action") action.current?.focus();
    if (focus?.target === "description") description.current?.focus();
  }, [focus]);

  const uploading = selection.status === "loading";
  const failed = selection.status === "error";
  const choose = () => input.current?.click();
  const controls = {
    empty: { label: "Choose a picture", onClick: choose },
    loading: { label: "Cancel upload", onClick: field.cancel },
    error: { label: "Try again", onClick: field.retry },
    ready: { label: "Replace", onClick: choose },
  }[selection.status];
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const actionProps = {
    onClick: controls.onClick,
    "aria-describedby": problem ? `${hintId} ${problemId}` : hintId,
    "aria-invalid": problem ? (true as const) : undefined,
  };

  return (
    <div
      className="picture-field field"
      role="group"
      aria-labelledby={`${id}-label`}
    >
      <span className="field__label" id={`${id}-label`}>
        Picture <span className="picture-field__optional">(optional)</span>
      </span>
      <p className="field__hint" id={hintId}>
        {hint}
      </p>
      <input
        ref={input}
        type="file"
        hidden
        accept={PICTURE_TYPES}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) field.choose(file);
        }}
      />
      {selection.status === "empty" ? (
        <div className="picture-field__empty" data-invalid={Boolean(problem)}>
          <span className="picture-field__icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <circle cx="9" cy="10" r="1.8" />
              <path d="M4 17.5l5-4.5 4 3.2 3-2.4 4 3.2" />
            </svg>
          </span>
          <Button
            ref={action}
            type="button"
            variant="secondary"
            {...actionProps}
          >
            {controls.label}
          </Button>
        </div>
      ) : (
        <div className="picture-field__card" data-invalid={failed}>
          <div
            className="picture-field__preview"
            data-dim={uploading || failed}
          >
            <img
              src={selection.picture.url}
              alt="Preview of the picture you chose"
            />
            {uploading || failed ? (
              <div
                className="picture-field__overlay"
                aria-hidden={uploading || undefined}
              >
                <span className="picture-field__badge" data-invalid={failed}>
                  {uploading ? (
                    <span className="viewstate__pulse" aria-hidden="true" />
                  ) : null}
                  {uploading ? UPLOADING_PICTURE : "Not uploaded"}
                </span>
              </div>
            ) : null}
          </div>
          <div className="picture-field__row">
            <span className="picture-field__file">
              <b>{selection.picture.file.name}</b> ·{" "}
              {pictureSize(selection.picture.file.size)}
            </span>
            <div className="picture-field__actions">
              <Button
                ref={action}
                type="button"
                variant="secondary"
                size="small"
                {...actionProps}
              >
                {controls.label}
              </Button>
              {uploading ? null : (
                <Button
                  type="button"
                  variant="quiet"
                  aria-describedby={hintId}
                  onClick={field.remove}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {problem ? (
        <p className="field__problem" id={problemId}>
          {problem}
        </p>
      ) : null}
      <div className="visually-hidden">
        <ViewState
          data={ready}
          variant="compact"
          persistent
          readyNote={problem ?? field.status}
        >
          {() => null}
        </ViewState>
      </div>
      {field.status && !uploading ? (
        <p className="field__hint" aria-hidden="true">
          {field.status}
        </p>
      ) : null}
      {selection.status !== "empty" || field.description !== "" ? (
        <Field
          id={`${id}-description`}
          className="picture-field__description"
          label="Picture description"
          hint={descriptionHint}
          problem={field.descriptionProblem}
        >
          {(described) => (
            <textarea
              {...described}
              id={`${id}-description`}
              ref={description}
              className="field__control"
              aria-invalid={Boolean(field.descriptionProblem)}
              aria-required={selection.status !== "empty"}
              value={field.description}
              onChange={(event) =>
                field.changeDescription(event.currentTarget.value)
              }
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}
