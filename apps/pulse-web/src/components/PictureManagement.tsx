import type { PictureManagementController } from "../hooks/use-picture-management.js";
import { Button } from "./Button.js";
import { PictureField } from "./PictureField.js";
import { SignInAgain } from "./SignInAgain.js";
import { TwoPress } from "./TwoPress.js";
import "./PictureManagement.css";

export function PictureManagement({
  management,
  removalQuestion,
  signInHref,
  hidden = false,
}: {
  management: PictureManagementController;
  removalQuestion: string;
  signInHref: string;
  hidden?: boolean;
}) {
  const {
    submit,
    edit,
    askRemoval,
    remove,
    cancelRemoval,
    reloadPicture,
    checkAgain,
    fieldDisabled,
    picture,
    choosePicture,
    showRemove,
    removalBox,
    postedPicture,
    removal,
    status,
    outcome,
    fieldError,
    showReloaded,
    reloadedStatus,
    showReload,
    reloadFailed,
    signInAgain,
    signInStatus,
    chooseAgain,
    showCheckSignIn,
    checkSignIn,
  } = management;
  return (
    <details className="picture-management" hidden={hidden}>
      <summary className="picture-management__summary">Manage picture</summary>
      <form
        className="picture-management__form"
        onSubmit={submit}
        onChange={edit}
      >
        <fieldset ref={choosePicture} disabled={fieldDisabled}>
          <PictureField field={picture} />
          {picture.image ? (
            <Button variant="primary">Save picture</Button>
          ) : null}
        </fieldset>
        {showRemove ? (
          <div className="picture-management__removal" ref={removalBox}>
            <TwoPress
              key={postedPicture}
              label="Remove posted picture"
              question={removalQuestion}
              confirmLabel="Remove picture"
              pendingLabel="Removing picture…"
              progress={removal}
              onAsk={askRemoval}
              onConfirm={remove}
              onCancel={cancelRemoval}
            />
          </div>
        ) : null}
        {status ? (
          <p ref={outcome.status} tabIndex={-1} role="status">
            {status}
          </p>
        ) : null}
        {fieldError ? (
          <p
            className="picture-management__error"
            ref={outcome.alert}
            tabIndex={-1}
            role="alert"
          >
            {fieldError}
          </p>
        ) : null}
        {showReloaded ? (
          <p ref={reloadedStatus} tabIndex={-1} role="status">
            Picture reloaded.
          </p>
        ) : null}
        {showReload ? (
          <>
            {reloadFailed ? (
              <p className="picture-management__error" role="alert">
                Could not load the picture. Try again.
              </p>
            ) : null}
            <Button type="button" variant="secondary" onClick={reloadPicture}>
              Reload picture
            </Button>
          </>
        ) : null}
        {signInAgain ? (
          <>
            <SignInAgain
              href={signInHref}
              announce={false}
              {...(signInStatus ? { statusRef: signInStatus } : {})}
              chooseAgain={chooseAgain}
            />
            {showCheckSignIn ? (
              <Button
                type="button"
                variant="secondary"
                ref={checkSignIn}
                onClick={checkAgain}
              >
                Check sign-in again
              </Button>
            ) : null}
          </>
        ) : null}
      </form>
    </details>
  );
}
