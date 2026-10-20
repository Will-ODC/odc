import type { Attribution, NewPollRequest, PollMethod } from "../api/types.js";

/**
 * The posting form's decisions, kept out of React (ADR-0037).
 *
 * The limits mirror `POST /api/polls` in `apps/pulse/API.md`. They are
 * resource bounds, not a judgement of anyone's question: the server checks
 * them again, and the form only says so earlier and beside the right field.
 */
export const LIMITS = {
  question: 1000,
  choice: 200,
  name: 80,
  minChoices: 2,
  maxChoices: 25,
} as const;

/** The server's default when no closing time is sent: seven elapsed days. */
export const DEFAULT_OPEN_MS = 7 * 24 * 60 * 60 * 1000;

/** The only purpose statement version this client knows (ADR-0037). */
export const PURPOSE_VERSION = "community-purpose-v1";

export interface Draft {
  question: string;
  choices: string[];
  method: PollMethod;
  /**
   * `default` sends no closing time, so the server's clock decides.
   * `chosen` holds a `datetime-local` value, read in the person's time zone.
   */
  closing: { kind: "default" } | { kind: "chosen"; local: string };
  /** `name` is kept while anonymous, so switching back does not lose it. */
  attribution: { kind: "anonymous" | "named"; name: string };
  /** The first-post promise, ticked. Ignored once the account has made it. */
  promised: boolean;
}

export function emptyDraft(): Draft {
  return {
    question: "",
    choices: ["", ""],
    method: "single",
    closing: { kind: "default" },
    attribution: { kind: "anonymous", name: "" },
    promised: false,
  };
}

/** Each field's problem, in words to show beside it. Absent means fine. */
export interface Problems {
  question?: string;
  /** Position for position with `Draft.choices`. */
  choices: (string | undefined)[];
  closing?: string;
  name?: string;
  promise?: string;
}

/** Unicode code points, the unit the server counts, so emoji count as one. */
export function length(text: string): number {
  return [...text].length;
}

export function questionProblem(question: string): string | undefined {
  const text = question.trim();
  if (text === "") return "Write the question.";
  if (length(text) > LIMITS.question)
    return "Keep the question to 1,000 characters or fewer.";
  return undefined;
}

/**
 * Every choice's problem. A repeat is flagged on the later copy, so the first
 * one reads as fine and the person knows which to change.
 */
export function choiceProblems(
  choices: readonly string[],
): (string | undefined)[] {
  const seen = new Set<string>();
  return choices.map((choice) => {
    const text = choice.trim();
    if (text === "") return "Write this choice, or remove it.";
    if (length(text) > LIMITS.choice)
      return "Keep each choice to 200 characters or fewer.";
    if (seen.has(text)) return "This choice is already on the list.";
    seen.add(text);
    return undefined;
  });
}

export function nameProblem(draft: Draft): string | undefined {
  if (draft.attribution.kind === "anonymous") return undefined;
  const name = draft.attribution.name.trim();
  if (name === "") return "Write the name to show, or post anonymously.";
  if (length(name) > LIMITS.name)
    return "Keep the name to 80 characters or fewer.";
  return undefined;
}

/** When a chosen closing time is, or `null` when the field holds no time. */
export function chosenClose(local: string): Date | null {
  if (local === "") return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function closingProblem(draft: Draft, now: number): string | undefined {
  if (draft.closing.kind === "default") return undefined;
  const at = chosenClose(draft.closing.local);
  if (!at) return "Pick a date and time.";
  if (at.getTime() <= now) return "Pick a time after now.";
  return undefined;
}

/** Everything wrong with a draft, checked all at once before review. */
export function problemsOf(
  draft: Draft,
  needsPromise: boolean,
  now: number,
): Problems {
  const question = questionProblem(draft.question);
  const closing = closingProblem(draft, now);
  const name = nameProblem(draft);
  return {
    ...(question ? { question } : {}),
    choices: choiceProblems(draft.choices),
    ...(closing ? { closing } : {}),
    ...(name ? { name } : {}),
    ...(needsPromise && !draft.promised
      ? { promise: "Tick the promise to post your question." }
      : {}),
  };
}

export function hasProblems(problems: Problems): boolean {
  return (
    problems.question !== undefined ||
    problems.closing !== undefined ||
    problems.name !== undefined ||
    problems.promise !== undefined ||
    problems.choices.some((one) => one !== undefined)
  );
}

/** What the person chose to be shown as, trimmed. */
export function attributionOf(draft: Draft): Attribution {
  return draft.attribution.kind === "named"
    ? { kind: "named", name: draft.attribution.name.trim() }
    : { kind: "anonymous" };
}

/**
 * The request for a draft that has no problems. The promise is sent only
 * when the account has not made it yet: the server records it on success.
 */
export function requestOf(draft: Draft, needsPromise: boolean): NewPollRequest {
  const at =
    draft.closing.kind === "chosen" ? chosenClose(draft.closing.local) : null;
  return {
    question: draft.question.trim(),
    choices: draft.choices.map((choice) => choice.trim()),
    method: draft.method,
    ...(at ? { closesAt: at.toISOString() } : {}),
    attribution: attributionOf(draft),
    ...(needsPromise ? { purposeAcknowledgement: PURPOSE_VERSION } : {}),
  };
}

/** The earliest value the time picker offers: the next whole minute. */
export function pickerMin(now: number): string {
  const at = new Date(now + 60_000);
  at.setSeconds(0, 0);
  return localValue(at);
}

/** A date as a `datetime-local` value, in the person's time zone. */
export function localValue(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** A closing time as people read it: "Oct 27, 2026, 3:05 PM". */
export function readableClose(at: Date): string {
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** When the default closes, said from the form's own clock. */
export function defaultCloseNote(now: number): string {
  return `In seven days, on ${readableClose(new Date(now + DEFAULT_OPEN_MS))}`;
}

/**
 * Who posted a poll, for every place one is shown. `null` for a poll from
 * before posting existed, which says nothing rather than inventing an author.
 */
export function byline(attribution: Attribution | undefined): string | null {
  if (!attribution) return null;
  return attribution.kind === "named"
    ? `Posted by ${attribution.name}`
    : "Posted anonymously";
}

/** The one-line summaries the form shows in place of each setting. */
export function methodSummary(draft: Draft): string {
  return draft.method === "single"
    ? "People pick one choice"
    : "People pick any number of choices";
}

export function closingSummary(draft: Draft, now: number): string {
  if (draft.closing.kind === "default")
    return `Closes in seven days, on ${readableClose(new Date(now + DEFAULT_OPEN_MS))}`;
  const at = chosenClose(draft.closing.local);
  return at ? `Closes ${readableClose(at)}` : "Closes at a time you pick";
}

export function postedAsSummary(draft: Draft): string {
  if (draft.attribution.kind === "anonymous") return "Posted anonymously";
  const name = draft.attribution.name.trim();
  return name === "" ? "Posted under a name you choose" : `Posted by ${name}`;
}
