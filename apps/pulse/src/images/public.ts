/**
 * A poll's picture as its store hands it over: the poster's visible upload.
 * Present on a `Poll` or `PollSummary` only when `mayServe` allows it, so the
 * body and the picture route always agree. Never the uploading account,
 * upload time, original type or size.
 */
export interface PollImage {
  id: string;
  /** Size of the display variant. */
  width: number;
  height: number;
  alt: string;
}

/**
 * The public `image` field of a poll body and a listing row (ADR-0047
 * sections 6 and 12). `upload` is the poster's visible picture; `tile` means
 * the client draws the generated tile. Category defaults (`category`) arrive
 * with plan step 9. Nothing else is ever in it.
 */
export type PublicPollImage =
  | {
      kind: "upload";
      displayUrl: string;
      thumbUrl: string;
      width: number;
      height: number;
      alt: string;
    }
  | { kind: "tile" };

/** The relative URL of one stored variant. */
export function imageUrl(id: string, variant: "display" | "thumb"): string {
  return `/api/poll-images/${id}/${variant}.webp`;
}

/** The one projection of a poll's picture, field by field. */
export function publicPollImage(image: PollImage | undefined): PublicPollImage {
  if (image === undefined) return { kind: "tile" };
  return {
    kind: "upload",
    displayUrl: imageUrl(image.id, "display"),
    thumbUrl: imageUrl(image.id, "thumb"),
    width: image.width,
    height: image.height,
    alt: image.alt,
  };
}

/**
 * A copy of an already-public image object, rebuilt by name so nothing extra
 * can ride along. A stored creation response from before pictures has none,
 * and reads as the tile.
 */
export function copyPublicPollImage(
  image: PublicPollImage | undefined,
): PublicPollImage {
  if (image === undefined || image.kind !== "upload") return { kind: "tile" };
  return {
    kind: "upload",
    displayUrl: image.displayUrl,
    thumbUrl: image.thumbUrl,
    width: image.width,
    height: image.height,
    alt: image.alt,
  };
}
