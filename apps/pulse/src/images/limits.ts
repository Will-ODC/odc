/**
 * The picture limits of ADR-0047 sections 3 and 11, in one place so the
 * processor, the stores, the routes and the tests cannot disagree.
 */

/** Largest upload body, in bytes (10 MiB). nginx's upload location matches. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Largest input, in pixels (40 megapixels), read from the header. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Largest input side, in pixels. */
export const MAX_INPUT_SIDE = 8000;
/** Smallest shorter side, in pixels. */
export const MIN_INPUT_SIDE = 200;

/** The display variant fits within this square, aspect kept. */
export const DISPLAY_SIZE = 1600;
export const DISPLAY_QUALITY = 80;
/** The thumbnail is this square, centre crop (D3). */
export const THUMB_SIZE = 256;
export const THUMB_QUALITY = 75;

/** Pending pictures nobody attached are deleted after this long. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Accepted uploads per account per rolling hour. */
export const UPLOADS_PER_HOUR = 20;
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
/** Pending pictures one account may hold at once. */
export const MAX_PENDING = 5;

/** Alt text: 1 to 300 code points (ADR-0047 section 5). */
export const MAX_ALT_LENGTH = 300;

/** The declared types an upload may carry. The content decides the format. */
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type Variant = "display" | "thumb";
export const VARIANTS: readonly Variant[] = ["display", "thumb"];

/** A lowercase UUID, the only shape a picture id ever has. */
export const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
