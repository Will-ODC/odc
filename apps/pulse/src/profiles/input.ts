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

/**
 * The invisible characters the display-name rule lets through: the joiners
 * it allows (U+200C, U+200D) and the invisible marks, which are not format
 * characters (U+034F and the variation selectors). Ignored when comparing a
 * name with the reserved one, so none of them can hide it.
 */
const INVISIBLE =
  /\u200C|\u200D|\u034F|[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu;

/**
 * "Verified voter" is what a public vote shows for an account with no profile
 * name (ADR-0048 decision 8), so no profile may take it, in any case or
 * spacing, or with invisible characters in it. The same rule as
 * `member_profile_name_not_reserved` (migration 019).
 */
export function isReservedName(displayName: string): boolean {
  return (
    displayName
      .replace(INVISIBLE, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase() === "verified voter"
  );
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPublicProfileId(value: string): boolean {
  return UUID.test(value);
}
