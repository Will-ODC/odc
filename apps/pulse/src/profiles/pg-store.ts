import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../db/transaction.js";
import { normalizeProfile, type ProfileInput } from "./input.js";
import {
  ProfileStoreError,
  type MemberProfile,
  type MemberProfileStore,
  type ProfileActor,
  type ProfileStoreOptions,
  type PublicMemberProfile,
} from "./store.js";

interface ProfileRow {
  public_id: string;
  display_name: string;
  bio: string;
  visible: boolean;
  created_at: Date;
  updated_at: Date;
}

export class PostgresMemberProfileStore implements MemberProfileStore {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(pool: Pool, options: ProfileStoreOptions = {}) {
    this.#pool = pool;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async publicById(publicId: string): Promise<PublicMemberProfile | undefined> {
    const result = await this.#pool.query<ProfileRow>(
      "select public_id, display_name, bio, visible, created_at, updated_at from member_profile where public_id = $1 and visible = true",
      [publicId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const profile = fromRow(row);
    return {
      publicId: profile.publicId,
      displayName: profile.displayName,
      bio: profile.bio,
      createdAt: profile.createdAt,
    };
  }

  byOwner(actor: ProfileActor): Promise<MemberProfile | undefined> {
    return inTransaction(this.#pool, async (client) => {
      await verify(client, actor, false);
      const result = await client.query<ProfileRow>(
        "select public_id, display_name, bio, visible, created_at, updated_at from member_profile where voter_id = $1",
        [actor.voterId],
      );
      return result.rows[0] ? fromRow(result.rows[0]) : undefined;
    });
  }

  save(actor: ProfileActor, input: ProfileInput): Promise<MemberProfile> {
    const normalized = normalizeProfile(input);
    return inTransaction(this.#pool, async (client) => {
      await verify(client, actor, true);
      const now = this.#clock();
      const result = await client.query<ProfileRow>(
        "insert into member_profile (voter_id, public_id, display_name, bio, visible, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $6) on conflict (voter_id) do update set display_name = excluded.display_name, bio = excluded.bio, visible = excluded.visible, updated_at = greatest(member_profile.created_at, excluded.updated_at) returning public_id, display_name, bio, visible, created_at, updated_at",
        [
          actor.voterId,
          this.#newId(),
          normalized.displayName,
          normalized.bio,
          normalized.visible,
          now,
        ],
      );
      return fromRow(result.rows[0] as ProfileRow);
    });
  }
}

async function verify(
  client: PoolClient,
  actor: ProfileActor,
  lock: boolean,
): Promise<void> {
  const result = await client.query<{ session_generation: string }>(
    `select session_generation from voter where id = $1${lock ? " for update" : ""}`,
    [actor.voterId],
  );
  const generation = Number(result.rows[0]?.session_generation);
  if (
    !Number.isSafeInteger(actor.sessionGeneration) ||
    actor.sessionGeneration < 0 ||
    !Number.isSafeInteger(generation) ||
    generation !== actor.sessionGeneration
  )
    throw new ProfileStoreError("signed_out");
}

function fromRow(row: ProfileRow): MemberProfile {
  return {
    publicId: row.public_id,
    displayName: row.display_name,
    bio: row.bio,
    visible: row.visible,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
