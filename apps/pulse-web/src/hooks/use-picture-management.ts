import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { ContributionsError } from "../api/contributions.js";
import { pictureChangedMessage } from "../api/pictures.js";
import {
  ApiError,
  type PictureChange,
  type PulseApi,
  type PublicImage,
} from "../api/types.js";
import { SIGNED_IN_KEY } from "../flow/sign-in-return.js";
import { usePictureField } from "./use-picture-field.js";
import { useSave } from "./use-save.js";
import { focusLost, useSendOutcome, type Access } from "./use-send-outcome.js";
import type { TwoPressProgress } from "../components/TwoPress.js";

export type PictureRemovalConflict = {
  matches: (imageId: string) => boolean;
  remember: (imageId: string) => void;
};

export function usePictureManagement({
  access,
  canManage,
  api,
  image,
  readPicture,
  changePicture,
  retrySignInOnReturn = false,
  reloadOnConflict = true,
  removalConflict,
  onPictureChanged,
  onSignedOut,
}: {
  access: Access;
  canManage: boolean;
  api: PulseApi;
  image: PublicImage | undefined;
  readPicture: () => Promise<PublicImage | undefined>;
  changePicture: (change: PictureChange) => Promise<PublicImage>;
  retrySignInOnReturn?: boolean;
  reloadOnConflict?: boolean;
  removalConflict?: PictureRemovalConflict;
  onPictureChanged: (image: PublicImage) => void;
  onSignedOut: () => Promise<boolean>;
}) {
  const [uploadSignedOut, setUploadSignedOut] = useState(false);
  const [signInAttempt, retrySignIn] = useState(0);
  // The picture a removal was refused for (409 image_changed). Removal stays
  // off while that picture is the one shown, however it came back on screen,
  // so it is offered again only once a read has shown another (API.md).
  const [refused, setRefused] = useState<string | null>(null);
  // "Reload picture": whether the last press could not read, or did.
  const [reload, setReload] = useState<"failed" | "done">();
  async function refreshPicture() {
    const updated = await readPicture().catch(() => undefined);
    if (updated) onPictureChanged(updated);
    return updated !== undefined;
  }
  if (access === "expired" && uploadSignedOut) setUploadSignedOut(false);
  // A signed-out upload may drop the chosen picture: say to choose it again.
  const [uploadRefused, setUploadRefused] = useState(false);
  const picture = usePictureField(
    () => {
      setUploadSignedOut(true);
      setUploadRefused(true);
    },
    api,
    "save",
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const postedPicture =
    image?.kind === "upload"
      ? /^\/api\/poll-images\/([^/]+)\/display\.webp$/.exec(
          image.displayUrl,
        )?.[1]
      : undefined;
  const save = useSave<PictureChange>(async (change) => {
    try {
      onPictureChanged(await changePicture(change));
    } catch (error) {
      if (error instanceof ContributionsError || error instanceof ApiError) {
        if (error.code === "image_changed" && "expectedImageId" in change) {
          (removalConflict?.remember ?? setRefused)(change.expectedImageId);
          setReload(undefined);
          if (reloadOnConflict) await refreshPicture();
          setRemoving(null);
        } else if (
          error.status === 0 ||
          error.status >= 500 ||
          error.code === "image_unavailable"
        ) {
          // If this check cannot be read, the refusal stands: an unusable
          // upload is asked for again (its description kept), and a lost
          // reply keeps its error and Save for a retry with the same draft.
          const attached = await readPicture().catch(() => undefined);
          if (attached) {
            onPictureChanged(attached);
            if (
              "expectedImageId" in change
                ? attached.kind !== "upload"
                : attached.kind === "upload" &&
                  attached.displayUrl ===
                    `/api/poll-images/${encodeURIComponent(change.id)}/display.webp` &&
                  attached.alt === change.alt
            )
              return;
            // The removal's reply was lost and another picture is shown:
            // no error for a picture this page never confirmed.
            if (
              "expectedImageId" in change &&
              attached.kind === "upload" &&
              attached.displayUrl !==
                `/api/poll-images/${change.expectedImageId}/display.webp`
            )
              throw new ContributionsError(
                409,
                pictureChangedMessage,
                "image_changed",
              );
          }
          if (error.code === "image_unavailable")
            picture.reportPostError("image_unavailable");
        }
      }
      throw error;
    }
  }, picture.reset);
  const outcome = useSendOutcome(save, access);
  const signInStatus = useRef<HTMLParagraphElement>(null);
  const checkSignIn = useRef<HTMLButtonElement>(null);
  const checkingHadFocus = useRef(false);
  const rememberSignInFocus = useCallback(() => {
    const active = document.activeElement;
    checkingHadFocus.current ||=
      checkSignIn.current === active ||
      Boolean(signInStatus.current?.contains(active));
  }, []);
  const checkAgain = useCallback(() => {
    rememberSignInFocus();
    retrySignIn((n) => n + 1);
  }, [rememberSignInFocus]);
  const { errorStatus, clearFailure } = save;
  useEffect(() => {
    if (access !== "signedIn" || (!uploadSignedOut && errorStatus !== 401))
      return;
    let live = true;
    void onSignedOut().then((verified) => {
      if (!live || !verified) return;
      if (retrySignInOnReturn) rememberSignInFocus();

      setUploadSignedOut(false);
      clearFailure();
    });
    return () => {
      live = false;
    };
  }, [
    access,
    uploadSignedOut,
    errorStatus,
    onSignedOut,
    clearFailure,
    signInAttempt,
    retrySignInOnReturn,
    rememberSignInFocus,
  ]);
  const signInAgain =
    access === "expired" || uploadSignedOut || save.errorStatus === 401;
  const canWrite = canManage && !signInAgain;
  const choosePicture = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!retrySignInOnReturn || !signInAgain || access !== "signedIn") return;
    const announced = (event: StorageEvent) => {
      if (event.key === SIGNED_IN_KEY) checkAgain();
    };
    window.addEventListener("focus", checkAgain);
    window.addEventListener("storage", announced);
    return () => {
      window.removeEventListener("focus", checkAgain);
      window.removeEventListener("storage", announced);
    };
  }, [retrySignInOnReturn, signInAgain, access, checkAgain]);
  useLayoutEffect(() => {
    if (
      signInAgain &&
      (focusLost() || choosePicture.current?.contains(document.activeElement))
    ) {
      signInStatus.current?.focus();
    }
  }, [signInAgain]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canWrite && picture.checkPost() && picture.image) {
      setRemoving(null);
      setReload(undefined);
      void save.submit(picture.image);
    }
  }
  const error =
    save.failure?.code === "image_unavailable" ? undefined : save.error;
  const removingShown = removing !== null && removing === postedPicture;
  const removal: TwoPressProgress =
    removingShown && save.pending
      ? { status: "sending" }
      : removingShown && error
        ? { status: "failed", message: error }
        : { status: "idle" };
  const stale =
    postedPicture !== undefined &&
    (removalConflict?.matches(postedPicture) ?? postedPicture === refused);
  const showRemove =
    canWrite &&
    !stale &&
    postedPicture !== undefined &&
    (!save.pending || removingShown) &&
    picture.selection.status === "empty" &&
    picture.description === "";
  // Signed out: the sign-in prompt below says so on its own.
  const fieldError = removingShown || signInAgain ? undefined : error;
  const reloaded = reload === "done" && !stale;
  let status: string | undefined;
  if (save.pending && !removing) status = "Saving picture change…";
  if (save.saved) status = removing ? "Picture removed." : "Picture saved.";
  const showReload = stale && canWrite && !save.pending;
  const showCheckSignIn = signInAgain && access === "signedIn";
  const removalBox = useRef<HTMLDivElement>(null);
  const reloadedStatus = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (canWrite && checkingHadFocus.current && focusLost())
      choosePicture.current?.querySelector("button")?.focus();
    if (canWrite) checkingHadFocus.current = false;
  }, [canWrite]);
  // The pressed "Reload picture" goes once the newer picture shows: put
  // focus on what can be done with it, or say it has been reloaded.
  useLayoutEffect(() => {
    if (!reloaded || !focusLost()) return;
    (
      removalBox.current?.querySelector("button") ?? reloadedStatus.current
    )?.focus();
  }, [reloaded]);

  function clearStatus() {
    setReload(undefined);
    save.clearFailure();
    save.clearSaved();
  }
  function edit() {
    clearStatus();
    setUploadRefused(false);
    setUploadSignedOut(false);
  }
  function askRemoval() {
    clearStatus();
    return true;
  }
  function remove() {
    if (!postedPicture) return;
    setReload(undefined);
    setRemoving(postedPicture);
    void save.submit({ expectedImageId: postedPicture });
  }
  function cancelRemoval() {
    setRemoving(null);
    save.clearFailure();
  }
  function reloadPicture() {
    clearStatus();
    void refreshPicture().then((read) => setReload(read ? "done" : "failed"));
  }
  return {
    submit,
    edit,
    askRemoval,
    remove,
    cancelRemoval,
    reloadPicture,
    checkAgain,
    fieldDisabled: !canWrite || save.pending,
    picture,
    choosePicture,
    showRemove,
    removalBox,
    postedPicture,
    removal,
    status,
    outcome,
    fieldError,
    showReloaded: reloaded && !showRemove,
    reloadedStatus,
    showReload,
    reloadFailed: reload === "failed",
    signInAgain,
    signInStatus: retrySignInOnReturn ? signInStatus : undefined,
    chooseAgain: uploadRefused && picture.selection.status === "empty",
    showCheckSignIn,
    checkSignIn,
  };
}

export type PictureManagementController = ReturnType<
  typeof usePictureManagement
>;
