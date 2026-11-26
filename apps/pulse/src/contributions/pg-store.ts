import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PublicationActor } from "../authoring/store.js";
import {
  attachPicture,
  insertPictureChange,
  lockAttachablePending,
} from "../images/pg-store.js";
import { publicImage, type ItemImage } from "../images/public.js";
import type { PictureChange } from "../images/store.js";
import { mayServe, type OwnerKind } from "../images/visibility.js";
import { inTransaction } from "../db/transaction.js";
import { ContributionError, type ListQuery } from "./input.js";
import {
  ContributionsStore,
  type ContributionRecord,
  type ContributionPictureChange,
  type ContributionRepository,
  type ContributionTransaction,
  type Replay,
  type StoredContribution,
  type Summary,
} from "./store.js";
class PostgresRepository implements ContributionRepository {
  constructor(private readonly pool: Pool) {}
  async read(id: string) {
    return read(this.pool, id, false);
  }
  async list(query: ListQuery, ownerId?: string): Promise<Summary[]> {
    const result = await this.pool.query<
      PictureRow & {
        public: Omit<Summary, "image">;
      }
    >(
      `select c.public_record - 'participations' - 'updates' as public, ${pictureColumns}
       from contribution c ${pictureJoin}
       where ($1::timestamptz is null or (c.created_at, c.id) < ($1, $2))
         and ($3::text is null or c.owner_id = $3)
       order by c.created_at desc, c.id desc limit 21`,
      [
        query.before?.createdAt ?? null,
        query.before?.id ?? null,
        ownerId ?? null,
      ],
    );
    return result.rows.map((row) => ({
      ...row.public,
      image: publicImage(picture(row)),
    }));
  }
  transaction<T>(
    actor: PublicationActor,
    work: (tx: ContributionTransaction) => Promise<T>,
  ): Promise<T> {
    return inTransaction(this.pool, async (client) => {
      const account = (
        await client.query<{
          session_generation: string;
          community: string | null;
        }>(
          "select session_generation, community from voter where id=$1 for update",
          [actor.voterId],
        )
      ).rows[0];
      if (
        !account ||
        !Number.isSafeInteger(actor.sessionGeneration) ||
        actor.sessionGeneration < 0 ||
        Number(account.session_generation) !== actor.sessionGeneration
      )
        throw new ContributionError("signed_out");
      const community = (
        await client.query<{ id: string; label: string }>(
          "select id, label from community where id=$1",
          [account.community ?? "pulse-general"],
        )
      ).rows[0];
      if (!community) throw new Error("contribution community unavailable");
      return work({
        community,
        replay: async (key) =>
          (
            await client.query<Replay>(
              `select canonical, contribution_id as "contributionId", participation_count as "participationCount", update_count as "updateCount" from contribution_replay where voter_id=$1 and request_key=$2`,
              [actor.voterId, key],
            )
          ).rows[0],
        recent: async (since) =>
          Number(
            (
              await client.query<{ count: string }>(
                "select count(*) from contribution where owner_id=$1 and created_at > $2",
                [actor.voterId, since],
              )
            ).rows[0]?.count ?? 0,
          ),
        visiblePoll: async (id) =>
          (
            await client.query(
              "select 1 from polls where id=$1 and hidden=false",
              [id],
            )
          ).rowCount === 1,
        senderEntries: async (kind, contributionId) =>
          Number(
            (
              await client.query<{ count: string }>(
                "select count(*) from contribution_replay where voter_id=$1 and contribution_id=$2 and canonical::jsonb->>0=$3",
                [actor.voterId, contributionId, kind],
              )
            ).rows[0]?.count ?? 0,
          ),
        get: async (id) => read(client, id, true),
        save: async (record, isNew) => {
          if (isNew)
            await client.query(
              "insert into contribution (id,owner_id,created_at,public_record) values ($1,$2,$3,$4)",
              [
                record.public.id,
                record.ownerId,
                record.public.createdAt,
                JSON.stringify(record.public),
              ],
            );
          else
            await client.query(
              "update contribution set public_record=$2, private_messages=$3 where id=$1",
              [
                record.public.id,
                JSON.stringify(record.public),
                JSON.stringify(record.privateMessages ?? []),
              ],
            );
        },
        setPicture: (id, now, change) =>
          setPicture(client, actor.voterId, id, now, change),
        remember: async (key, replay) => {
          await client.query(
            "insert into contribution_replay (voter_id,request_key,canonical,contribution_id,participation_count,update_count) values ($1,$2,$3,$4,$5,$6)",
            [
              actor.voterId,
              key,
              replay.canonical,
              replay.contributionId,
              replay.participationCount,
              replay.updateCount,
            ],
          );
        },
      });
    });
  }
}
const pictureColumns =
  "c.id as contribution_id, c.image_id, i.id as picture_id, i.owner_kind, i.owner_id as picture_owner_id, i.width, i.height, i.alt";
const pictureJoin = "left join image i on i.id = c.image_id";

interface PictureRow {
  contribution_id: string;
  image_id: string | null;
  picture_id: string | null;
  owner_kind: OwnerKind | null;
  picture_owner_id: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
}

function picture(row: PictureRow): ItemImage | undefined {
  const { picture_id: id, picture_owner_id: ownerId, width, height, alt } = row;
  if (
    id === null ||
    width === null ||
    height === null ||
    alt === null ||
    ownerId !== row.contribution_id ||
    !mayServe(
      { id, ownerKind: row.owner_kind, ownerId },
      {
        kind: "contribution",
        currentImageId: row.image_id,
        visible: true,
      },
    )
  )
    return undefined;
  return { id, width, height, alt };
}

/** The contribution was inserted or locked by this transaction. */
async function setPicture(
  client: PoolClient,
  actorId: string,
  id: string,
  now: Date,
  operation: ContributionPictureChange,
): Promise<ItemImage | undefined> {
  const {
    rows: [old],
  } = await client.query<{ id: string; sha256: string }>(
    "select b.image_id as id, b.sha256 from contribution c" +
      " join image_bytes b on b.image_id = c.image_id and b.variant = 'display'" +
      " where c.id = $1",
    [id],
  );
  if (operation.action === "image_remove" && !old) return undefined;
  const change: PictureChange = {
    targetKind: "contribution",
    targetId: id,
    action: operation.action,
    changeId: randomUUID(),
    actorId,
    now,
  };
  let image: ItemImage | undefined;
  if (operation.action === "image_remove") {
    await client.query(
      "update contribution set image_id = null where id = $1",
      [id],
    );
    if (old) await insertPictureChange(client, old, change);
  } else {
    const { id: pendingId, alt } = operation.input;
    const pending = await lockAttachablePending(
      client,
      pendingId,
      actorId,
      now,
    );
    if (!pending) throw new ContributionError("image_unavailable");
    await client.query("update contribution set image_id = $2 where id = $1", [
      id,
      pending.id,
    ]);
    image = await attachPicture(client, pending, alt, change);
  }
  if (old) await client.query("delete from image where id = $1", [old.id]);
  return image;
}

async function read(
  client: Pool | PoolClient,
  id: string,
  lock: boolean,
): Promise<StoredContribution | undefined> {
  // Read the picture after locking the parent. A joined locking query could
  // wait for a replacement and still see the older image-table snapshot.
  if (lock)
    await client.query("select id from contribution where id = $1 for update", [
      id,
    ]);
  const row = (
    await client.query<
      PictureRow & {
        owner_id: string;
        public_record: ContributionRecord;
        private_messages?: NonNullable<StoredContribution["privateMessages"]>;
      }
    >(
      `select c.owner_id, c.public_record${lock ? ", c.private_messages" : ""}, ${pictureColumns}
       from contribution c ${pictureJoin} where c.id=$1`,
      [id],
    )
  ).rows[0];
  const image = row && picture(row);
  return row
    ? {
        ownerId: row.owner_id,
        public: row.public_record,
        ...(image ? { image } : {}),
        ...(row.private_messages
          ? { privateMessages: row.private_messages }
          : {}),
      }
    : undefined;
}
export class PostgresContributionsStore extends ContributionsStore {
  constructor(pool: Pool, clock?: () => Date) {
    super(new PostgresRepository(pool), clock);
  }
}
