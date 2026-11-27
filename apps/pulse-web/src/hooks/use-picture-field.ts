import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type PulseApi } from "../api/types.js";
import {
  fileProblem,
  measurePicture,
  uploadProblem,
  type PicturePurpose,
} from "./picture-upload-errors.js";

export const UPLOADING_PICTURE = "Uploading picture…";
const waitForUpload = "Wait for the picture to finish uploading, or cancel it.";

type Picture = { file: File; url: string };
type Uploaded = { status: "ready"; picture: Picture; id: string };
type Selection =
  | { status: "empty" }
  | { status: "loading" | "error"; picture: Picture }
  | Uploaded;
type Attempt = {
  controller: AbortController;
  fallback: Selection;
  description: string;
  picture: Picture;
  problem: string | undefined;
};
const empty: Selection = { status: "empty" };

/**
 * Keep this hook in the posting form so the draft can survive its sign-in
 * prompt. Pass the form's api prop as client. Call checkPost on submit, and
 * pass image only when it returns true.
 * Forward Post errors to reportPostError; signed_out also calls onSignedOut.
 */
export function usePictureField(
  onSignedOut: () => void,
  client: PulseApi,
  purpose: PicturePurpose = "post",
) {
  const [selection, setSelection] = useState<Selection>(empty);
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string>();
  const [status, setStatus] = useState("");
  const [postAttempted, setPostAttempted] = useState(false);
  const [focus, setFocus] = useState<{
    target: "action" | "focused-action" | "description";
  }>();
  const active = useRef<Attempt | null>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const ownedUrls = urls.current;
    return () => {
      active.current?.controller.abort();
      active.current = null;
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedUrls.clear();
    };
  }, []);

  function release(picture: Picture) {
    URL.revokeObjectURL(picture.url);
    urls.current.delete(picture.url);
  }

  function clearSelection() {
    active.current?.controller.abort();
    active.current = null;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setSelection(empty);
    setProblem(undefined);
    setStatus("");
    setPostAttempted(false);
  }

  function reportPostError(
    code: "image_unavailable" | "signed_out",
    target: "action" | "focused-action" = "action",
  ) {
    clearSelection();
    if (code === "signed_out") {
      onSignedOut();
    } else {
      setProblem(
        purpose === "save"
          ? "This picture is no longer available. Choose it again. Its description is kept."
          : "This picture is no longer available. Choose it again. Its description and the rest of your draft are kept.",
      );
    }
    setFocus({ target });
  }

  function fail(attempt: Attempt, message: string, retry = false) {
    if (attempt.fallback.status === "ready") {
      release(attempt.picture);
      setSelection(attempt.fallback);
      setDescription(attempt.description);
    } else if (retry) {
      setSelection({ status: "error", picture: attempt.picture });
    } else {
      release(attempt.picture);
      setSelection(empty);
    }
    setStatus("");
    setProblem(message);
    setFocus({
      target: attempt.fallback.status === "ready" ? "action" : "focused-action",
    });
  }

  async function upload(picture: Picture) {
    const attempt: Attempt = {
      picture,
      controller: new AbortController(),
      fallback: selection,
      description,
      problem,
    };
    active.current = attempt;
    setSelection({ status: "loading", picture });
    setProblem(undefined);
    setStatus(UPLOADING_PICTURE);
    setPostAttempted(false);
    setFocus({ target: "action" });

    let id: string;
    try {
      id = await client.uploadPicture(picture.file, attempt.controller.signal);
    } catch (error) {
      if (active.current !== attempt) return;
      const code = error instanceof ApiError ? error.code : undefined;
      const dimensions =
        code === "image_dimensions"
          ? await measurePicture(picture.file)
          : undefined;
      if (active.current !== attempt) return;
      active.current = null;
      if (code === "signed_out") {
        reportPostError(
          "signed_out",
          attempt.fallback.status === "ready" ? "action" : "focused-action",
        );
      } else {
        const refusal = uploadProblem(error, picture.file, dimensions, purpose);
        fail(attempt, refusal.message, refusal.retry);
      }
      return;
    }
    if (active.current !== attempt) return;
    active.current = null;
    setSelection({ status: "ready", picture, id });
    setProblem(undefined);
    if (attempt.fallback.status === "ready") {
      release(attempt.fallback.picture);
      setStatus(
        "Picture replaced. Check that the description still fits the new one.",
      );
      setFocus({ target: "action" });
    } else {
      setStatus("Picture uploaded.");
    }
  }

  function choose(file: File) {
    if (active.current || selection.status === "error") return;
    setStatus("");
    const invalidFile = fileProblem(file);
    if (invalidFile) {
      setProblem(invalidFile);
      setFocus({ target: "action" });
      return;
    }
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    void upload({ file, url });
  }

  function retry() {
    if (!active.current && selection.status === "error") {
      void upload(selection.picture);
    }
  }

  function cancel() {
    const attempt = active.current;
    if (!attempt) return;
    attempt.controller.abort();
    active.current = null;
    if (attempt.fallback.status === "error") {
      // A cancelled retry still has the same unuploaded file.
      setSelection(attempt.fallback);
      setProblem(attempt.problem);
    } else {
      release(attempt.picture);
      setSelection(attempt.fallback);
      setProblem(undefined);
    }
    if (attempt.fallback.status === "ready") {
      setDescription(attempt.description);
    }
    setStatus("");
    setFocus({ target: "action" });
  }

  function reset() {
    clearSelection();
    setDescription("");
  }

  function remove() {
    reset();
    setStatus("Picture removed.");
    setFocus({ target: "action" });
  }

  const alt = description.trim();
  const count = [...alt].length;
  const invalidCharacters = alt.includes("\0") || /[\uD800-\uDFFF]/u.test(alt);
  const orphan = selection.status === "empty" && description !== "";
  const canPost =
    (selection.status === "empty" && !orphan) ||
    (selection.status === "ready" &&
      count > 0 &&
      count <= 300 &&
      !invalidCharacters);

  let descriptionProblem: string | undefined;
  if (orphan && postAttempted) {
    descriptionProblem =
      purpose === "save"
        ? "Choose the picture again before saving it."
        : "Choose the picture again, or clear its description to post without a picture.";
  } else if (invalidCharacters) {
    descriptionProblem =
      "Remove any invalid characters from the picture description.";
  } else if (count > 300) {
    descriptionProblem = `Keep the description to 300 characters. It is ${count} now.`;
  } else if (selection.status === "ready" && count === 0 && postAttempted) {
    descriptionProblem = `Describe the picture before you ${purpose}, or remove it.`;
  }

  function checkPost(moveFocus = true): boolean {
    if (active.current || selection.status === "loading") {
      setProblem(waitForUpload);
      if (moveFocus) setFocus({ target: "action" });
      return false;
    }
    if (canPost) return true;
    setStatus("");
    setPostAttempted(true);
    if (moveFocus) {
      setFocus({
        target: selection.status === "error" ? "action" : "description",
      });
    }
    return false;
  }

  const changeDescription = useCallback((value: string) => {
    setDescription(value);
    setStatus((current) => (current === UPLOADING_PICTURE ? current : ""));
  }, []);

  return {
    purpose,
    selection,
    problem,
    status,
    description,
    descriptionProblem,
    focus,
    choose,
    retry,
    cancel,
    remove,
    reset,
    changeDescription,
    canPost,
    image: selection.status === "ready" ? { id: selection.id, alt } : undefined,
    checkPost,
    reportPostError,
  };
}

export type PictureFieldController = ReturnType<typeof usePictureField>;
