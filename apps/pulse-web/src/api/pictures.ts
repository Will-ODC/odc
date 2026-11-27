import type { PublicImage } from "./types.js";

export const pictureChangedMessage =
  "The posted picture changed. Review it before removing.";

export function publicImage(value: unknown): value is PublicImage {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return false;
  if (value.kind === "tile") return true;
  const image = value as Record<string, unknown>;
  return (
    (value.kind === "upload" || value.kind === "category") &&
    typeof image.displayUrl === "string" &&
    typeof image.thumbUrl === "string" &&
    typeof image.alt === "string" &&
    typeof image.width === "number" &&
    image.width > 0 &&
    typeof image.height === "number" &&
    image.height > 0
  );
}
