import { createPoll, type PollMethod } from "../voting/poll.js";

export const PURPOSE_VERSION = "community-purpose-v1";
export const WEEK_MS = 604_800_000;
export const HOUR_MS = 3_600_000;
export type Attribution =
  { kind: "anonymous" } | { kind: "named"; name: string };
export interface CreationInput {
  question: string;
  choices: string[];
  method: PollMethod;
  attribution: Attribution;
  closesAt: string | null;
  purposeAcknowledgement: string | null;
}
export class CreationError extends Error {
  constructor(
    readonly code:
      | "bad_request"
      | "signed_out"
      | "purpose_required"
      | "idempotency_conflict"
      | "posting_limit"
      | "owner_required"
      | "not_found",
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "CreationError";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requestKey(value: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new CreationError("bad_request");
  return value.toLowerCase();
}
function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CreationError("bad_request");
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new CreationError("bad_request");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string") throw new CreationError("bad_request");
  const normalized = value.trim();
  // Unicode mode treats valid surrogate pairs as one astral code point.
  if (normalized.includes("\u0000") || /[\uD800-\uDFFF]/u.test(normalized))
    throw new CreationError("bad_request");

  if (!normalized || [...normalized].length > limit)
    throw new CreationError("bad_request");
  return normalized;
}
/** No time-relative checks here: a committed request must replay after close. */
export function normalizeCreation(value: unknown): CreationInput {
  const row = object(value, [
    "question",
    "choices",
    "method",
    "attribution",
    "closesAt",
    "purposeAcknowledgement",
  ]);
  const question = text(row.question, 1000);
  if (!Array.isArray(row.choices)) throw new CreationError("bad_request");
  const choices = row.choices.map((choice: unknown) => text(choice, 200));
  if (row.method !== "single" && row.method !== "approval")
    throw new CreationError("bad_request");
  try {
    createPoll({ id: "validation", question, choices, method: row.method });
  } catch {
    throw new CreationError("bad_request");
  }
  let attribution: Attribution = { kind: "anonymous" };
  if ("attribution" in row) {
    const a = object(row.attribution, ["kind", "name"]);
    if (a.kind === "named")
      attribution = { kind: "named", name: text(a.name, 80) };
    else if (a.kind !== "anonymous" || "name" in a)
      throw new CreationError("bad_request");
  }
  let closesAt: string | null = null;
  if ("closesAt" in row) {
    if (
      typeof row.closesAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.closesAt)
    )
      throw new CreationError("bad_request");
    const date = new Date(row.closesAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== row.closesAt)
      throw new CreationError("bad_request");
    closesAt = row.closesAt;
  }
  if (
    "purposeAcknowledgement" in row &&
    row.purposeAcknowledgement !== PURPOSE_VERSION
  )
    throw new CreationError("bad_request");
  return {
    question,
    choices,
    method: row.method,
    attribution,
    closesAt,
    purposeAcknowledgement:
      row.purposeAcknowledgement === PURPOSE_VERSION ? PURPOSE_VERSION : null,
  };
}
