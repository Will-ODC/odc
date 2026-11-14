/**
 * Whether a picture may be served, decided per owner kind in this one
 * function (ADR-0047 sections 1 and 4). The in-memory and Postgres picture
 * stores call it for the picture routes, and the in-memory and Postgres
 * voting stores call it for the `image` field of poll bodies and listings,
 * so a body never points at a picture its route would refuse.
 */

export type OwnerKind = "poll" | "community";

/** A picture's link to what shows it. Both null while it is pending. */
export interface ImageLink {
  id: string;
  ownerKind: OwnerKind | null;
  ownerId: string | null;
}

/**
 * The state of the owner a picture names, as its store read it. Undefined
 * when the owner does not exist.
 *
 * - `poll`: the poll's current picture, and whether the poll is visible
 *   (today: not `hidden`; soft delete joins this in a later step).
 * - `community`: the community's current default picture. Nothing sets one
 *   until category defaults are built (ADR-0047 section 6, plan step 9), so
 *   the stores report `null` and no community picture is served yet.
 */
export type OwnerState =
  | { kind: "poll"; currentImageId: string | null; visible: boolean }
  | { kind: "community"; defaultImageId: string | null };

export function mayServe(
  image: ImageLink,
  owner: OwnerState | undefined,
): boolean {
  // Pending: attached to nothing, so visible to nobody.
  if (image.ownerKind === null || image.ownerId === null) return false;
  if (owner === undefined || owner.kind !== image.ownerKind) return false;
  switch (owner.kind) {
    case "poll":
      return owner.visible && owner.currentImageId === image.id;
    case "community":
      return owner.defaultImageId === image.id;
    default:
      // Unreachable for a well-typed store; an unknown kind is never served.
      return false;
  }
}
