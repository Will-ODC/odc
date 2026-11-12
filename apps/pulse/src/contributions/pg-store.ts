import type { Pool, PoolClient } from "pg";
import type { PublicationActor } from "../authoring/store.js";
import { inTransaction } from "../db/transaction.js";
import { ContributionError, type ListQuery } from "./input.js";
import {
  ContributionsStore,
  type Contribution,
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
  async list(query: ListQuery): Promise<Summary[]> {
    const result = await this.pool.query<{ public: Summary }>(
      "select public_record - 'participations' - 'updates' as public from contribution where ($1::timestamptz is null or (created_at, id) < ($1, $2)) order by created_at desc, id desc limit 21",
      [query.before?.createdAt ?? null, query.before?.id ?? null],
    );
    return result.rows.map((r) => r.public);
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
              "update contribution set public_record=$2 where id=$1",
              [record.public.id, JSON.stringify(record.public)],
            );
        },
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
async function read(
  client: Pool | PoolClient,
  id: string,
  lock: boolean,
): Promise<StoredContribution | undefined> {
  const row = (
    await client.query<{ owner_id: string; public_record: Contribution }>(
      `select owner_id, public_record from contribution where id=$1${lock ? " for update" : ""}`,
      [id],
    )
  ).rows[0];
  return row ? { ownerId: row.owner_id, public: row.public_record } : undefined;
}
export class PostgresContributionsStore extends ContributionsStore {
  constructor(pool: Pool, clock?: () => Date) {
    super(new PostgresRepository(pool), clock);
  }
}
