import type { PictureInput } from "../images/input.js";
import type { ItemImage } from "../images/public.js";
import type { PublicationActor } from "./store.js";

export type PollPictureEdit =
  | { action: "image_replace"; input: PictureInput }
  | { action: "image_remove"; expectedImageId?: string };

export interface PollPictureStore {
  canManagePicture(voterId: string, id: string): Promise<boolean>;
  changePicture(
    actor: PublicationActor,
    id: string,
    operation: PollPictureEdit,
  ): Promise<ItemImage | undefined>;
}

export class PollPictureError extends Error {
  constructor(
    readonly code: "poster_required" | "image_changed" | "image_unavailable",
  ) {
    super(code);
    this.name = "PollPictureError";
  }
}
