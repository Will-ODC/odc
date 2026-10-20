import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../db/transaction.js";
import { parseEmail } from "../identity/email.js";
import { createPoll } from "../voting/poll.js";
import { publicPoll as projectPoll } from "../voting/public-poll.js";
import {
  CreationError,
  HOUR_MS,
  PURPOSE_VERSION,
  WEEK_MS,
  normalizeCreation,
  requestKey,
} from "./input.js";

export type {
  PublicationActor,
  PublicationPoll,
  PublicationResult,
  CreationContext,
} from "./store.js";
import type {
  CreationStore,
  CreationOptions,
  PublicationActor,
  PublicationPoll,
  PublicationResult,
  CreationContext,
} from "./store.js";

interface AccountRow {
  id: string;
  community: string | null;
  session_generation: string;
}
/** Internal store only. HTTP must validate expiry/origin before passing an actor. */
export class PostgresCreationStore implements CreationStore {
  readonly #pool: Pool;
  readonly #ownerEmail: string | null;
  readonly #clock: () => Date;
  readonly #newId: () => string;
  constructor(pool: Pool, options: CreationOptions = {}) {
    this.#pool = pool;
    try {
      this.#ownerEmail =
        options.ownerEmail === undefined
          ? null
          : parseEmail(options.ownerEmail).value;
    } catch {
      throw new Error("PULSE_OWNER_EMAIL is not a usable address");
    }
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async context(actor: PublicationActor): Promise<CreationContext> {
    return inTransaction(this.#pool, async (client) => {
      const account = await this.#account(client, actor);
      const community = await this.#community(client, account);
      const canPostUnlimited = await this.#unlimited(client, account.id);
      const ack = await client.query(
        "select 1 from publication_acknowledgement where voter_id = $1 and purpose_version = $2",
        [account.id, PURPOSE_VERSION],
      );
      return {
        community,
        canPostUnlimited,
        purposeVersion: PURPOSE_VERSION,
        purposeAcknowledged: ack.rowCount === 1,
      };
    });
  }

  async publish(
    actor: PublicationActor,
    key: string,
    body: unknown,
  ): Promise<PublicationResult> {
    const input = normalizeCreation(body);
    key = requestKey(key);
    return inTransaction(this.#pool, async (client) => {
      const account = await this.#account(client, actor);
      const canonical = JSON.stringify(input);
      const replay = await client.query<{
        same: boolean;
        public_response: PublicationPoll;
      }>(
        "select canonical_input = $3::jsonb as same, public_response from poll_creation_replay where voter_id = $1 and request_key = $2",
        [account.id, key, canonical],
      );
      if (replay.rows[0]) {
        if (!replay.rows[0].same)
          throw new CreationError("idempotency_conflict");
        return { poll: replay.rows[0].public_response, replayed: true };
      }
      const now = this.#clock();
      const closesAt =
        input.closesAt === null
          ? new Date(now.getTime() + WEEK_MS)
          : new Date(input.closesAt);
      if (
        !Number.isFinite(now.getTime()) ||
        !Number.isFinite(closesAt.getTime()) ||
        closesAt <= now
      )
        throw new CreationError("bad_request");
      const ack = await client.query(
        "select 1 from publication_acknowledgement where voter_id = $1 and purpose_version = $2",
        [account.id, PURPOSE_VERSION],
      );
      if (
        ack.rowCount !== 1 &&
        input.purposeAcknowledgement !== PURPOSE_VERSION
      )
        throw new CreationError("purpose_required");
      if (!(await this.#unlimited(client, account.id))) {
        const recent = await client.query<{ created_at: Date }>(
          "select created_at from polls where created_by = $1 and created_at > $2 order by created_at",
          [account.id, new Date(now.getTime() - HOUR_MS)],
        );
        if (recent.rows.length >= 5) {
          const retry = Math.max(
            1,
            Math.ceil(
              ((recent.rows[recent.rows.length - 5]?.created_at.getTime() ??
                now.getTime()) +
                HOUR_MS -
                now.getTime()) /
                1000,
            ),
          );
          throw new CreationError("posting_limit", retry);
        }
      }
      const community = await this.#community(client, account);
      const poll = createPoll(
        {
          id: this.#newId(),
          question: input.question,
          choices: input.choices,
          method: input.method,
          closesAt,
        },
        now,
      );
      await client.query(
        "insert into polls (id, question, method, created_at, closes_at, accepts_suggestions, community, created_by, attribution_kind, author_name) values ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)",
        [
          poll.id,
          poll.question,
          poll.method,
          now,
          closesAt,
          community.id,
          account.id,
          input.attribution.kind,
          input.attribution.kind === "named" ? input.attribution.name : null,
        ],
      );
      for (const [position, label] of poll.choices.entries())
        await client.query(
          "insert into poll_choice (id, poll_id, position, label) values ($1, $2, $3, $4)",
          [this.#newId(), poll.id, position, label],
        );
      // The same projection GET /api/polls/:id serves, so the two cannot drift.
      const publicPoll: PublicationPoll = projectPoll(
        { ...poll, publication: { community, attribution: input.attribution } },
        now,
      );
      await client.query(
        "insert into publication_acknowledgement (voter_id, purpose_version, acknowledged_at) values ($1, $2, $3) on conflict (voter_id) do nothing",
        [account.id, PURPOSE_VERSION, now],
      );
      await client.query(
        "insert into poll_creation_replay (voter_id, request_key, poll_id, canonical_input, public_response) values ($1, $2, $3, $4, $5)",
        [account.id, key, poll.id, canonical, JSON.stringify(publicPoll)],
      );
      return { poll: publicPoll, replayed: false };
    });
  }

  async setUnlimited(
    actor: PublicationActor,
    target: string,
    enabled: boolean,
  ): Promise<void> {
    if (typeof enabled !== "boolean") throw new CreationError("bad_request");
    await inTransaction(this.#pool, async (client) => {
      // Refuse outsiders before looking up or locking the target account.
      const initial = await client.query<AccountRow>(
        "select id, community, session_generation from voter where id = $1",
        [actor.voterId],
      );
      this.#verify(initial.rows[0], actor);
      if (!(await this.#owner(client, actor.voterId)))
        throw new CreationError("owner_required");
      // Deterministic lock order; creation, sign-out and grant changes share voter rows.
      const locked = await client.query<AccountRow>(
        "select id, community, session_generation from voter where id = any($1::text[]) order by id for update",
        [[actor.voterId, target]],
      );
      const account = locked.rows.find((row) => row.id === actor.voterId);
      this.#verify(account, actor);
      if (!(await this.#owner(client, actor.voterId)))
        throw new CreationError("owner_required");
      if (!locked.rows.some((row) => row.id === target))
        throw new CreationError("not_found");
      const current = await client.query<{ enabled: boolean }>(
        "select enabled from posting_permission where voter_id = $1",
        [target],
      );
      if ((current.rows[0]?.enabled ?? false) === enabled) return;
      const now = this.#clock();
      await client.query(
        "insert into posting_permission (voter_id, enabled, changed_by, changed_at) values ($1, $2, $3, $4) on conflict (voter_id) do update set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at",
        [target, enabled, actor.voterId, now],
      );
      await client.query(
        "insert into posting_permission_change (id, voter_id, enabled, changed_by, changed_at) values ($1, $2, $3, $4, $5)",
        [this.#newId(), target, enabled, actor.voterId, now],
      );
    });
  }

  async #account(
    client: PoolClient,
    actor: PublicationActor,
  ): Promise<AccountRow> {
    const rows = await client.query<AccountRow>(
      "select id, community, session_generation from voter where id = $1 for update",
      [actor.voterId],
    );
    const row = rows.rows[0];
    this.#verify(row, actor);
    return row as AccountRow;
  }
  #verify(row: AccountRow | undefined, actor: PublicationActor): void {
    if (
      !row ||
      !Number.isSafeInteger(actor.sessionGeneration) ||
      actor.sessionGeneration < 0 ||
      !Number.isSafeInteger(Number(row.session_generation)) ||
      Number(row.session_generation) !== actor.sessionGeneration
    )
      throw new CreationError("signed_out");
  }
  async #owner(client: PoolClient, voterId: string): Promise<boolean> {
    if (this.#ownerEmail === null) return false;
    const result = await client.query(
      "select 1 from voter_credential where voter_id = $1 and kind = 'email' and value = $2",
      [voterId, this.#ownerEmail],
    );
    return result.rowCount === 1;
  }
  async #unlimited(client: PoolClient, voterId: string): Promise<boolean> {
    if (await this.#owner(client, voterId)) return true;
    const result = await client.query(
      "select 1 from posting_permission where voter_id = $1 and enabled = true",
      [voterId],
    );
    return result.rowCount === 1;
  }
  async #community(
    client: PoolClient,
    account: AccountRow,
  ): Promise<{ id: string; label: string }> {
    const result = await client.query<{ id: string; label: string }>(
      "select id, label from community where id = $1",
      [account.community ?? "pulse-general"],
    );
    const row = result.rows[0];
    if (!row) throw new Error("posting community is not configured");
    return row;
  }
}
