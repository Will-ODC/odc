import { randomUUID } from "node:crypto";
import type { InMemoryVoterStore } from "../identity/store.js";
import type { InMemoryVotingStore } from "../voting/store.js";
import {
  MAX_PENDING,
  PENDING_TTL_MS,
  UPLOADS_PER_HOUR,
  UPLOAD_WINDOW_MS,
  type Variant,
} from "./limits.js";
import type { ProcessedImage } from "./process.js";
import type { PollImage } from "./public.js";
import { mayServe, type OwnerKind } from "./visibility.js";

/** The signed-in account uploading, as the creation routes pass it. */
export interface ImageActor {
  voterId: string;
  sessionGeneration: number;
}

/** A store refusal. The route turns each into its own answer. */
export class ImageStoreError extends Error {
  constructor(
    readonly code: "signed_out" | "upload_limit" | "pending_limit",
    /** Seconds until an upload slot frees, for `upload_limit`. */
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "ImageStoreError";
  }
}

/** What a pending upload answers with: its id and the display variant's size. */
export interface SavedImage {
  id: string;
  width: number;
  height: number;
}

/** A served variant: the stored bytes and their SHA-256 (the ETag). */
export interface ServedVariant {
  bytes: Buffer;
  sha256: string;
}

export interface ImageStore {
  /**
   * Refuse early when this account may not upload now: signed out, 20
   * accepted uploads in the rolling hour, or 5 pictures already pending. Read
   * only; the route calls it before spending a decode on the file.
   */
  checkAllowance(actor: ImageActor): Promise<void>;
  /**
   * Keep a processed upload as a pending picture of this account. Checks the
   * same limits again, serialized per account, so two uploads racing cannot
   * both take the last slot.
   */
  savePending(actor: ImageActor, image: ProcessedImage): Promise<SavedImage>;
  /** One variant of a picture, only if `mayServe` allows it; else undefined. */
  servable(id: string, variant: Variant): Promise<ServedVariant | undefined>;
  /**
   * Delete every pending picture uploaded 24 hours or more ago, with its
   * bytes. Best-effort housekeeping: run at startup and on each upload.
   * Returns how many went.
   */
  sweepPending(): Promise<number>;
}

export interface ImageStoreOptions {
  clock?: () => Date;
  newId?: () => string;
}

/** One picture in memory: its metadata, link and both variants, together. */
export interface MemoryImage {
  id: string;
  uploadedBy: string;
  uploadedAt: number;
  width: number;
  height: number;
  ownerKind: OwnerKind | null;
  ownerId: string | null;
  alt: string | null;
  attachedAt: number | null;
  variants: Record<Variant, ServedVariant>;
}

/** One row of the in-memory change table; append-only like Postgres's. */
export interface MemoryContentChange {
  id: string;
  targetKind: OwnerKind;
  targetId: string;
  imageId: string | null;
  imageSha256: string | null;
  action: "image_attach";
  actorKind: "poster" | "site_owner" | "auto";
  actorId: string | null;
  changedAt: Date;
}

export interface MemoryImageDatabase {
  images: Map<string, MemoryImage>;
  changes: MemoryContentChange[];
}

// One voting store is one ephemeral database, as in the creation store.
const databases = new WeakMap<InMemoryVotingStore, MemoryImageDatabase>();

/** The in-memory picture tables that belong to this voting store's database. */
export function memoryImageDatabase(
  voting: InMemoryVotingStore,
): MemoryImageDatabase {
  let found = databases.get(voting);
  if (!found) {
    found = { images: new Map(), changes: [] };
    databases.set(voting, found);
  }
  return found;
}

/**
 * The pending picture this account may attach now, or undefined: unknown,
 * someone else's, already attached, or past its 24 hours. One answer for
 * all of them, so attaching reveals nothing about another account's uploads.
 */
export function attachablePending(
  db: MemoryImageDatabase,
  imageId: string,
  accountId: string,
  now: Date,
): MemoryImage | undefined {
  const image = db.images.get(imageId);
  if (
    !image ||
    image.uploadedBy !== accountId ||
    image.ownerKind !== null ||
    image.uploadedAt <= now.getTime() - PENDING_TTL_MS
  )
    return undefined;
  return image;
}

/** Attach a pending picture to a poll and record it; the caller checked it. */
export function attachInMemory(
  db: MemoryImageDatabase,
  image: MemoryImage,
  attach: {
    pollId: string;
    alt: string;
    actorId: string;
    now: Date;
    changeId: string;
  },
): PollImage {
  image.ownerKind = "poll";
  image.ownerId = attach.pollId;
  image.alt = attach.alt;
  image.attachedAt = attach.now.getTime();
  db.changes.push({
    id: attach.changeId,
    targetKind: "poll",
    targetId: attach.pollId,
    imageId: image.id,
    imageSha256: image.variants.display.sha256,
    action: "image_attach",
    actorKind: "poster",
    actorId: attach.actorId,
    changedAt: attach.now,
  });
  return {
    id: image.id,
    width: image.width,
    height: image.height,
    alt: attach.alt,
  };
}

/** Same-process reference only; deployed instances must use Postgres. */
export class InMemoryImageStore implements ImageStore {
  readonly #voters: InMemoryVoterStore;
  readonly #voting: InMemoryVotingStore;
  readonly #db: MemoryImageDatabase;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(
    voters: InMemoryVoterStore,
    voting: InMemoryVotingStore,
    options: ImageStoreOptions = {},
  ) {
    this.#voters = voters;
    this.#voting = voting;
    this.#db = memoryImageDatabase(voting);
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  checkAllowance(actor: ImageActor): Promise<void> {
    return this.#voters.exclusive(async () => {
      await this.#account(actor);
      this.#allowance(actor.voterId, this.#clock());
    });
  }

  savePending(actor: ImageActor, image: ProcessedImage): Promise<SavedImage> {
    return this.#voters.exclusive(async () => {
      await this.#account(actor);
      const now = this.#clock();
      this.#allowance(actor.voterId, now);
      const id = this.#newId();
      if (this.#db.images.has(id)) throw new Error("picture id already used");
      this.#db.images.set(id, {
        id,
        uploadedBy: actor.voterId,
        uploadedAt: now.getTime(),
        width: image.width,
        height: image.height,
        ownerKind: null,
        ownerId: null,
        alt: null,
        attachedAt: null,
        variants: {
          display: copy(image.display),
          thumb: copy(image.thumb),
        },
      });
      return { id, width: image.width, height: image.height };
    });
  }

  async servable(
    id: string,
    variant: Variant,
  ): Promise<ServedVariant | undefined> {
    const image = this.#db.images.get(id);
    if (!image) return undefined;
    const poll =
      image.ownerKind === "poll" && image.ownerId !== null
        ? await this.#voting.getPoll(image.ownerId)
        : undefined;
    const owner =
      image.ownerKind === "poll"
        ? poll && {
            kind: "poll" as const,
            currentImageId: poll.image?.id ?? null,
            // The in-memory store has no hidden polls.
            visible: true,
          }
        : image.ownerKind === "community"
          ? { kind: "community" as const, defaultImageId: null }
          : undefined;
    if (!mayServe(image, owner)) return undefined;
    return copy(image.variants[variant]);
  }

  async sweepPending(): Promise<number> {
    const cutoff = this.#clock().getTime() - PENDING_TTL_MS;
    let swept = 0;
    for (const [id, image] of this.#db.images) {
      if (image.ownerKind === null && image.uploadedAt <= cutoff) {
        // Row and bytes are one object: they go together.
        this.#db.images.delete(id);
        swept++;
      }
    }
    return swept;
  }

  #allowance(voterId: string, now: Date): void {
    const mine = [...this.#db.images.values()].filter(
      (image) => image.uploadedBy === voterId,
    );
    const recent = mine
      .map((image) => image.uploadedAt)
      .filter((at) => at > now.getTime() - UPLOAD_WINDOW_MS)
      .sort((a, b) => a - b);
    if (recent.length >= UPLOADS_PER_HOUR) {
      const oldest = recent[recent.length - UPLOADS_PER_HOUR] ?? now.getTime();
      throw new ImageStoreError(
        "upload_limit",
        Math.max(
          1,
          Math.ceil((oldest + UPLOAD_WINDOW_MS - now.getTime()) / 1000),
        ),
      );
    }
    const pending = mine.filter(
      (image) =>
        image.ownerKind === null &&
        image.uploadedAt > now.getTime() - PENDING_TTL_MS,
    );
    if (pending.length >= MAX_PENDING)
      throw new ImageStoreError("pending_limit");
  }

  async #account(actor: ImageActor): Promise<void> {
    const row = await this.#voters.byId(actor.voterId);
    if (
      !row ||
      !Number.isSafeInteger(actor.sessionGeneration) ||
      (row.sessionGeneration ?? 0) !== actor.sessionGeneration
    )
      throw new ImageStoreError("signed_out");
  }
}

function copy(variant: ServedVariant): ServedVariant {
  return { bytes: Buffer.from(variant.bytes), sha256: variant.sha256 };
}
