import { useCallback, useRef, useState } from "react";
import { ContributionsError } from "../api/contributions.js";
import { ApiError } from "../api/types.js";

/** Retains a request key across uncertain retries, rotating when the payload changes. */
export function useSave<T>(
  save: (input: T, key: string) => Promise<unknown>,
  done: () => void,
) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    status?: number;
    code?: string | undefined;
  }>();
  const [saved, setSaved] = useState(false);
  const sending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  async function submit(input: T) {
    if (sending.current) return;
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    sending.current = true;
    setPending(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await save(input, attempt.current.key);
      attempt.current = null;
      setSaved(true);
      done();
    } catch (reason) {
      setFailure({
        message:
          reason instanceof Error
            ? reason.message
            : "Could not save. Please try again.",
        ...(reason instanceof ContributionsError || reason instanceof ApiError
          ? { status: reason.status, code: reason.code }
          : {}),
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  /** Forget the last failure, e.g. once signing in again has fixed it. */
  const clearFailure = useCallback(() => setFailure(undefined), []);
  /** Put away the last thank-you, e.g. once the person starts another entry. */
  const clearSaved = useCallback(() => setSaved(false), []);
  return {
    pending,
    clearFailure,
    clearSaved,
    /** A new object per failure, so an effect can react to each one. */
    failure,
    error: failure?.message,
    errorStatus: failure?.status,
    saved,
    submit,
  };
}
