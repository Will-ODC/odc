import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../db/transaction.js";
import {
  MAX_PENDING,
  PENDING_TTL_MS,
  UPLOADS_PER_HOUR,
  UPLOAD_WINDOW_MS,
  type Variant,
} from "./limits.js";
import type { ProcessedImage } from "./process.js";
import type { ItemImage } from "./public.js";
import {
  ImageStoreError,
  type ImageActor,
  type ImageStore,
  type ImageStoreOptions,
  type PictureChange,
  type SavedImage,
  type ServedVariant,
} from "./store.js";
import { mayServe, type OwnerKind, type OwnerState } from "./visibility.js";

/**
 * Pictures in Pulse's own Postgres (ADR-0047 section 1): `image` for the
 * metadata and owner link, `image_bytes` for the two variants. Held to the
 * same conformance suite as the in-memory store.
 *
 * Time comes from the injected clock, never the database (ADR-0021).
 */
export class PostgresImageStore implements ImageStore {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(pool: Pool, options: ImageStoreOptions = {}) {
    this.#pool = pool;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async checkAllowance(actor: ImageActor): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await account(client, actor, false);
      await allowance(client, actor.voterId, this.#clock());
    } finally {
      client.release();
    }
  }

  async savePending(
    actor: ImageActor,
    image: ProcessedImage,
  ): Promise<SavedImage> {
    return inTransaction(this.#pool, async (client) => {
      // The account row lock serializes one account's uploads, as it does
      // its publications, so the limits below cannot be raced past.
      await account(client, actor, true);
      const now = this.#clock();
      await allowance(client, actor.voterId, now);
      const id = this.#newId();
      await client.query(
        "insert into image (id, uploaded_by, uploaded_at, width, height)" +
          " values ($1, $2, $3, $4, $5)",
        [id, actor.voterId, now, image.width, image.height],
      );
      await client.query(
        "insert into image_upload (id, uploaded_by, uploaded_at)" +
          " values ($1, $2, $3)",
        [this.#newId(), actor.voterId, now],
      );
      for (const variant of ["display", "thumb"] as const)
        await client.query(
          "insert into image_bytes (image_id, variant, bytes, sha256)" +
            " values ($1, $2, $3, $4)",
          [id, variant, image[variant].bytes, image[variant].sha256],
        );
      return { id, width: image.width, height: image.height };
    });
  }

  async servable(
    id: string,
    variant: Variant,
  ): Promise<ServedVariant | undefined> {
    const { rows } = await this.#pool.query<{
      owner_kind: OwnerKind | null;
      owner_id: string | null;
      bytes: Buffer;
      sha256: string;
      poll_id: string | null;
      poll_image_id: string | null;
      poll_hidden: boolean | null;
      contribution_id: string | null;
      contribution_image_id: string | null;
    }>(
      "select i.owner_kind, i.owner_id, b.bytes, b.sha256," +
        " p.id as poll_id, p.image_id as poll_image_id, p.hidden as poll_hidden," +
        " c.id as contribution_id, c.image_id as contribution_image_id" +
        " from image i" +
        " join image_bytes b on b.image_id = i.id and b.variant = $2" +
        " left join polls p on i.owner_kind = 'poll' and p.id = i.owner_id" +
        " left join contribution c on i.owner_kind = 'contribution' and c.id = i.owner_id" +
        " where i.id = $1",
      [id, variant],
    );
    const row = rows[0];
    if (!row) return undefined;
    const owner: OwnerState | undefined =
      row.owner_kind === "poll"
        ? row.poll_id === null
          ? undefined
          : {
              kind: "poll",
              currentImageId: row.poll_image_id,
              visible: row.poll_hidden === false,
            }
        : row.owner_kind === "community"
          ? // No community default can be set before plan step 9.
            { kind: "community", defaultImageId: null }
          : row.owner_kind === "contribution" && row.contribution_id !== null
            ? {
                kind: "contribution",
                currentImageId: row.contribution_image_id,
                visible: true,
              }
            : undefined;
    const link = { id, ownerKind: row.owner_kind, ownerId: row.owner_id };
    if (!mayServe(link, owner)) return undefined;
    return { bytes: row.bytes, sha256: row.sha256 };
  }

  async sweepPending(): Promise<number> {
    const now = this.#clock().getTime();
    // Bytes cascade with their row: both go in this one statement.
    const result = await this.#pool.query(
      "delete from image where owner_kind is null and uploaded_at <= $1",
      [new Date(now - PENDING_TTL_MS)],
    );
    // Upload records the hourly quota can no longer count.
    await this.#pool.query("delete from image_upload where uploaded_at <= $1", [
      new Date(now - UPLOAD_WINDOW_MS),
    ]);
    return result.rowCount ?? 0;
  }
}

/**
 * The pending picture this account may attach now, locked for the caller's
 * transaction, or undefined: unknown, someone else's, already attached, or
 * past its 24 hours — one answer for all of them. Used by the creation store
 * inside its publication transaction.
 */
export async function lockAttachablePending(
  client: PoolClient,
  imageId: string,
  accountId: string,
  now: Date,
): Promise<
  { id: string; width: number; height: number; sha256: string } | undefined
> {
  const { rows } = await client.query<{
    id: string;
    width: number;
    height: number;
    sha256: string;
  }>(
    "select i.id, i.width, i.height, b.sha256 from image i" +
      " join image_bytes b on b.image_id = i.id and b.variant = 'display'" +
      " where i.id = $1 and i.uploaded_by = $2 and i.owner_kind is null" +
      " and i.uploaded_at > $3 for update of i",
    [imageId, accountId, new Date(now.getTime() - PENDING_TTL_MS)],
  );
  return rows[0];
}

/** Attach a locked pending picture and record it in the same transaction. */
export async function attachPicture(
  client: PoolClient,
  image: { id: string; width: number; height: number; sha256: string },
  alt: string,
  change: PictureChange,
): Promise<ItemImage> {
  const updated = await client.query(
    "update image set owner_kind = $1, owner_id = $2, alt = $3," +
      " attached_at = $4 where id = $5 and owner_kind is null",
    [change.targetKind, change.targetId, alt, change.now, image.id],
  );
  if (updated.rowCount !== 1) throw new Error("picture was not pending");
  await insertPictureChange(client, image, change);
  return { id: image.id, width: image.width, height: image.height, alt };
}

export async function insertPictureChange(
  client: PoolClient,
  image: { id: string; sha256: string },
  change: PictureChange,
): Promise<void> {
  await client.query(
    "insert into content_change (id, target_kind, target_id, image_id," +
      " image_sha256, action, actor_kind, actor_id, changed_at)" +
      " values ($1, $2, $3, $4, $5, $6, 'poster', $7, $8)",
    [
      change.changeId,
      change.targetKind,
      change.targetId,
      image.id,
      image.sha256,
      change.action,
      change.actorId,
      change.now,
    ],
  );
}

async function account(
  client: PoolClient,
  actor: ImageActor,
  lock: boolean,
): Promise<void> {
  const { rows } = await client.query<{ session_generation: string }>(
    "select session_generation from voter where id = $1" +
      (lock ? " for update" : ""),
    [actor.voterId],
  );
  const row = rows[0];
  if (
    !row ||
    !Number.isSafeInteger(actor.sessionGeneration) ||
    Number(row.session_generation) !== actor.sessionGeneration
  )
    throw new ImageStoreError("signed_out");
}

async function allowance(
  client: PoolClient,
  voterId: string,
  now: Date,
): Promise<void> {
  const recent = await client.query<{ uploaded_at: Date }>(
    // The upload records, not the pictures: deleting a picture never refunds.
    "select uploaded_at from image_upload where uploaded_by = $1" +
      " and uploaded_at > $2" +
      " order by uploaded_at",
    [voterId, new Date(now.getTime() - UPLOAD_WINDOW_MS)],
  );
  if (recent.rows.length >= UPLOADS_PER_HOUR) {
    const oldest =
      recent.rows[
        recent.rows.length - UPLOADS_PER_HOUR
      ]?.uploaded_at.getTime() ?? now.getTime();
    throw new ImageStoreError(
      "upload_limit",
      Math.max(
        1,
        Math.ceil((oldest + UPLOAD_WINDOW_MS - now.getTime()) / 1000),
      ),
    );
  }
  const pending = await client.query<{ n: number }>(
    "select count(*)::int as n from image where uploaded_by = $1" +
      " and owner_kind is null and uploaded_at > $2",
    [voterId, new Date(now.getTime() - PENDING_TTL_MS)],
  );
  if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING)
    throw new ImageStoreError("pending_limit");
}
