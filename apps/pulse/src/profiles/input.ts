export interface ProfileInput {
  displayName: string;
  bio: string;
  visible: boolean;
}

export class ProfileInputError extends Error {
  constructor() {
    super("bad_request");
    this.name = "ProfileInputError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProfileInputError();
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "bio,displayName,visible")
    throw new ProfileInputError();
  return row;
}

/**
 * The display-name rule. `apps/pulse-web/src/flow/profile-name.ts` repeats it
 * so the editor can say what is wrong before saving; the parity test in
 * `tests/pulse-integration` keeps the two identical.
 *
 * A name needs at least one character people can see. It may not contain
 * control or format characters — which covers the bidi overrides and isolates
 * (U+202A–U+202E, U+2066–U+2069) that can make a name read as something else —
 * except the zero-width joiner and non-joiner (U+200D, U+200C), which emoji
 * sequences and Persian and Indic names need. A name made only of those two
 * still has nothing visible and is refused.
 */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
const HIDDEN = /(?![\u200C\u200D])[\p{Cc}\p{Cf}]/u;

function text(
  value: unknown,
  limit: number,
  empty: boolean,
  displayName = false,
): string {
  if (typeof value !== "string") throw new ProfileInputError();
  const normalized = value.trim();
  if (normalized.includes("\u0000") || /[\uD800-\uDFFF]/u.test(normalized))
    throw new ProfileInputError();
  if (displayName && (HIDDEN.test(normalized) || !VISIBLE.test(normalized)))
    throw new ProfileInputError();
  if ((!empty && normalized === "") || [...normalized].length > limit)
    throw new ProfileInputError();
  return normalized;
}

export function normalizeProfile(value: unknown): ProfileInput {
  const row = object(value);
  if (typeof row.visible !== "boolean") throw new ProfileInputError();
  return {
    displayName: text(row.displayName, 80, false, true),
    bio: text(row.bio, 280, true),
    visible: row.visible,
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPublicProfileId(value: string): boolean {
  return UUID.test(value);
}
