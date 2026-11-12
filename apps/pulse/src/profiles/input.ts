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

function text(value: unknown, limit: number, empty: boolean): string {
  if (typeof value !== "string") throw new ProfileInputError();
  const normalized = value.trim();
  if (normalized.includes("\u0000") || /[\uD800-\uDFFF]/u.test(normalized))
    throw new ProfileInputError();
  if ((!empty && normalized === "") || [...normalized].length > limit)
    throw new ProfileInputError();
  return normalized;
}

export function normalizeProfile(value: unknown): ProfileInput {
  const row = object(value);
  if (typeof row.visible !== "boolean") throw new ProfileInputError();
  return {
    displayName: text(row.displayName, 80, false),
    bio: text(row.bio, 280, true),
    visible: row.visible,
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPublicProfileId(value: string): boolean {
  return UUID.test(value);
}
