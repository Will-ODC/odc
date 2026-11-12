import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../db/transaction.js";
import type { PollImage } from "../images/public.js";
import { mayServe, type OwnerKind } from "../images/visibility.js";
import type { PollListQuery, PollSummary } from "./listing.js";
import {
  createPoll,
  isOpen,
  type NewPoll,
  type Poll,
  type PollMethod,
  type Publication,
} from "./poll.js";
import {
  UnknownPollError,
  assertCastOptions,
  assertConfirmation,
  assertLockKey,
  resultsFor,
  validateBallot,
  type CastOptions,
  type CastResult,
  type ConfirmingPerson,
  type Results,
  type HistoryVote,
  type Vote,
  type VoteBefore,
  type VotingStore,
} from "./store.js";

/**
 * The voting store on Postgres — ADR-0021's four tables (`polls`,
 * `poll_choice`, `vote`, `vote_choice`) — held to the same conformance suite as
 * the in-memory store (`test/conformance/voting-store.ts`).
 *
 * Two rules the schema cannot keep, so this file does:
 *
 * - **A vote's choices belong to the vote's own poll.** Nothing ties
 *   `vote_choice`'s two foreign keys to one poll (see `001_initial.sql`), so
 *   every statement that writes or reads a pair names the poll on both sides.
 * - **Time comes from the injected clock, never the database** (ADR-0021).
 *
 * The wire still carries `ballot: number[]` — choice positions, value 1 each —
 * and this is the edge where positions become choice ids.
 */
export class PostgresVotingStore implements VotingStore {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(
    pool: Pool,
    clock: () => Date = () => new Date(),
    newId: () => string = () => randomUUID(),
  ) {
    this.#pool = pool;
    this.#clock = clock;
    this.#newId = newId;
  }

  async createPoll(input: NewPoll): Promise<Poll> {
    // The same shape rules as every store, checked before anything is written.
    const poll = createPoll(input, this.#clock());
    await inTransaction(this.#pool, async (client) => {
      const { rowCount } = await client.query(
        "insert into polls" +
          " (id, question, method, created_at, closes_at, accepts_suggestions)" +
          " values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing",
        [
          poll.id,
          poll.question,
          poll.method,
          poll.createdAt,
          poll.closesAt ?? null,
          poll.acceptsSuggestions,
        ],
      );
      // The same refusal, and the same error, as the in-memory store.
      if (rowCount === 0) {
        throw new TypeError(`poll already exists: ${poll.id}`);
      }
      for (const [position, label] of poll.choices.entries()) {
        await client.query(
          "insert into poll_choice (id, poll_id, position, label, next_poll_id)" +
            " values ($1, $2, $3, $4, $5)",
          [
            this.#newId(),
            poll.id,
            position,
            label,
            poll.next[position] ?? null,
          ],
        );
      }
    });
    return poll;
  }

  async setSeedCommunity(pollId: string, community: string): Promise<void> {
    const result = await this.#pool.query(
      "update polls set community = $2 where id = $1 and created_by is null returning id",
      [pollId, community],
    );
    if (result.rowCount !== 1)
      throw new TypeError("seed poll missing or authored");
  }

  async getPoll(pollId: string): Promise<Poll | undefined> {
    // The authored columns (ADR-0037) are read for their public facts only.
    // `created_by` is deliberately not selected: the author's account never
    // leaves the creation store, so no projection can copy it by mistake.
    const { rows } = await this.#pool.query<PollRow>(
      "select p.id, p.question, p.method, p.created_at, p.closes_at," +
        " p.accepts_suggestions, p.attribution_kind, p.author_name," +
        " c.id as community_id, c.label as community_label," +
        ` ${IMAGE_COLUMNS}` +
        " from polls p left join community c on c.id = p.community" +
        " left join image i on i.id = p.image_id" +
        " where p.id = $1",
      [pollId],
    );
    const row = rows[0];
    if (!row) return undefined;

    const choices = await this.#pool.query<ChoiceRow>(
      "select label, next_poll_id from poll_choice" +
        " where poll_id = $1 order by position",
      [pollId],
    );
    const poll: Poll = {
      id: row.id,
      question: row.question,
      choices: choices.rows.map((choice) => choice.label),
      // Plain text in the table on purpose (ADR-0021); `createPoll` checked it
      // against the known methods before this store ever wrote it.
      method: row.method as PollMethod,
      next: choices.rows.map((choice) => choice.next_poll_id),
      createdAt: row.created_at,
      acceptsSuggestions: row.accepts_suggestions,
    };
    const publication = publicationOf(row);
    const image = pollImageOf(row);
    // No close time means no `closesAt` key, exactly as `createPoll` builds it;
    // no authorship means no `publication` key, as the in-memory store has it.
    return {
      ...poll,
      ...(row.closes_at ? { closesAt: row.closes_at } : {}),
      ...(publication ? { publication } : {}),
      ...(image ? { image } : {}),
    };
  }

  async listPolls(query: PollListQuery): Promise<PollSummary[]> {
    const { rows } = await this.#pool.query<
      {
        id: string;
        question: string;
        method: PollMethod;
        created_at: Date;
        closes_at: Date | null;
      } & ImageColumns
    >(
      "select p.id, p.question, p.method, p.created_at, p.closes_at," +
        ` ${IMAGE_COLUMNS}` +
        " from polls p left join image i on i.id = p.image_id" +
        " where p.community = $1 and not p.hidden" +
        ' and ($2::timestamptz is null or (p.created_at, p.id collate "C")' +
        ' < ($2::timestamptz, $3::text collate "C"))' +
        ' order by p.created_at desc, p.id collate "C" desc limit $4',
      [
        query.community,
        query.before?.createdAt ?? null,
        query.before?.id ?? null,
        query.limit + 1,
      ],
    );
    return rows.map((p) => {
      const image = pollImageOf(p);
      return {
        id: p.id,
        question: p.question,
        method: p.method,
        createdAt: p.created_at,
        ...(p.closes_at ? { closesAt: p.closes_at } : {}),
        ...(image ? { image } : {}),
      };
    });
  }

  async castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
    options: CastOptions = {},
  ): Promise<CastResult> {
    const poll = await this.#requirePoll(pollId);
    if (voterId.trim() === "") throw new TypeError("voterId must not be empty");
    validateBallot(poll, ballot);
    assertCastOptions(options);

    const now = this.#clock();
    // Checked before anything is written, so a late cast replaces nothing.
    if (!isOpen(poll, now)) return { status: "closed" };

    const choices = [...ballot].sort((a, b) => a - b);
    const inserted = await inTransaction(this.#pool, async (client) => {
      if (options.confirmation !== undefined) {
        // ADR-0046: one ballot per person per poll. This cast is the person's
        // latest answer, so their ballot in any other browser on this poll
        // goes (its `vote_choice` rows cascade). The person's lock comes
        // first, before any row lock, so this cannot interleave with another
        // of their casts or a sign-in; vote_poll_confirmation_key is the
        // backstop if some path ever skipped it.
        await lockPerson(client, options.lockKey);
        // Then both rows this cast touches — this browser's, and the
        // person's in another browser — in one statement, in `id` order.
        // Another person's write holds a different person lock, so only this
        // order keeps two people whose ballots sit crossed on each other's
        // browsers from deadlocking (ADR-0046 decision 6).
        await client.query(
          "select id from vote where poll_id = $1" +
            " and (voter_id = $2 or confirmation = $3)" +
            " order by id for update",
          [pollId, voterId, options.confirmation],
        );
        await client.query(
          "delete from vote where poll_id = $1 and confirmation = $2" +
            " and voter_id <> $3",
          [pollId, options.confirmation, voterId],
        );
      }
      // One row per (poll, voter), and re-casting REPLACES it: the upsert pulse
      // is exempt to use and `services/` is not. `xmax = 0` holds only for a
      // row this statement inserted, which keeps "counted" and "changed" right
      // when two casts from one browser race — the second waits on the row
      // lock and then updates.
      //
      // A confirmation given replaces the one held; none given keeps it, so
      // changing an answer while signed out keeps the vote confirmed
      // (ADR-0040). Never cleared here.
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        "insert into vote (id, poll_id, voter_id, cast_at, confirmation)" +
          " values ($1, $2, $3, $4, $5)" +
          " on conflict (poll_id, voter_id)" +
          " do update set cast_at = excluded.cast_at," +
          "   confirmation = coalesce(excluded.confirmation, vote.confirmation)" +
          " returning id, (xmax = 0) as inserted",
        [this.#newId(), pollId, voterId, now, options.confirmation ?? null],
      );
      const vote = only(rows);
      await client.query("delete from vote_choice where vote_id = $1", [
        vote.id,
      ]);
      // Positions become ids inside THIS poll, in the statement that writes
      // them — the guard 001_initial.sql leaves to the store.
      await client.query(
        "insert into vote_choice (vote_id, choice_id)" +
          " select $1, id from poll_choice" +
          " where poll_id = $2 and position = any($3::int[])",
        [vote.id, pollId, choices],
      );
      return vote.inserted;
    });

    const vote: Vote = { pollId, voterId, choices, castAt: now };
    return { status: inserted ? "counted" : "changed", vote };
  }

  async confirmVotes(
    voterId: string,
    person: ConfirmingPerson,
  ): Promise<number> {
    assertLockKey(person.lockKey);
    const now = this.#clock();
    return inTransaction(this.#pool, async (client) => {
      // The person's lock first (ADR-0046), as a confirmed cast takes it, so
      // a sign-in and a cast by one person run one after the other.
      await lockPerson(client, person.lockKey);
      // Open polls only, by the injected clock: a closed poll's results stop
      // changing when it closes. Read without a lock: it only says which
      // polls, and so which codes, this sign-in is about.
      const { rows: held } = await client.query<{ poll_id: string }>(
        "select v.poll_id from vote v" +
          " join polls p on p.id = v.poll_id" +
          " where v.voter_id = $1" +
          "   and (p.closes_at is null or p.closes_at > $2)",
        [voterId, now],
      );
      // Every code is made and checked before anything is locked or written.
      const polls = held.map((row) => row.poll_id);
      const codes = polls.map((poll) => {
        const code = person.codeFor(poll);
        assertConfirmation(code);
        return code;
      });
      // Then every row this sign-in can touch — this browser's on those
      // polls, and the person's ballot on each in any other browser — locked
      // in ONE statement, in `id` order (ADR-0046 decision 6). The person
      // lock orders this person's writes; this order is what keeps two
      // different people from deadlocking when each signs in on a browser
      // holding the other's ballot. Under read committed a row changed while
      // we waited is re-checked, and dropped if it no longer matches: no row
      // can newly take this person's code meanwhile, as only their own
      // writes, which wait on the person lock, set it.
      const { rows: locked } = await client.query<{
        id: string;
        poll_id: string;
        voter_id: string;
        confirmation: string | null;
      }>(
        "select id, poll_id, voter_id, confirmation from vote" +
          " where (voter_id = $1 and poll_id = any($2::text[]))" +
          "   or (poll_id, confirmation) in" +
          "     (select * from unnest($2::text[], $3::text[]))" +
          " order by id for update",
        [voterId, polls, codes],
      );
      let confirmed = 0;
      for (const [at, pollId] of polls.entries()) {
        const code = codes[at] as string;
        const row = locked.find(
          (r) => r.poll_id === pollId && r.voter_id === voterId,
        );
        // Moved or deleted by someone else's write while we waited.
        if (!row) continue;
        confirmed++;
        const rival = locked.find(
          (r) =>
            r.poll_id === pollId && r.confirmation === code && r.id !== row.id,
        );
        if (!rival) {
          await client.query(
            "update vote set confirmation = $2 where id = $1",
            [row.id, code],
          );
          continue;
        }
        // The person's ballot on this poll in another browser: whether it
        // beats this one by ADR-0040's rule, compared in the order
        // `confirmedTally` reads, so the database picks as results would.
        const { rows: compared } = await client.query<{ wins: boolean }>(
          'select (r.cast_at, r.voter_id collate "C")' +
            ' > (t.cast_at, t.voter_id collate "C") as wins' +
            " from vote r, vote t where r.id = $1 and t.id = $2",
          [rival.id, row.id],
        );
        if (compared[0]?.wins) {
          // ADR-0046 4A: the newer answer moves to this browser. This row
          // goes first, as (poll_id, voter_id) is unique; the rival keeps its
          // choices, cast time and code, filed under this ballot identity.
          await client.query("delete from vote where id = $1", [row.id]);
          await client.query("update vote set voter_id = $2 where id = $1", [
            rival.id,
            voterId,
          ]);
          continue;
        }
        await client.query("delete from vote where id = $1", [rival.id]);
        await client.query("update vote set confirmation = $2 where id = $1", [
          row.id,
          code,
        ]);
      }
      return confirmed;
    });
  }

  async voteOf(pollId: string, voterId: string): Promise<Vote | undefined> {
    // The choice must be the vote's own poll's (`c.poll_id = v.poll_id`): a
    // pair naming another poll's choice is never read back as an answer.
    const { rows } = await this.#pool.query<{
      cast_at: Date;
      position: number | null;
    }>(
      "select v.cast_at, c.position from vote v" +
        " left join vote_choice vc on vc.vote_id = v.id" +
        " left join poll_choice c" +
        "   on c.id = vc.choice_id and c.poll_id = v.poll_id" +
        " where v.poll_id = $1 and v.voter_id = $2" +
        " order by c.position",
      [pollId, voterId],
    );
    const first = rows[0];
    if (!first) return undefined;
    return {
      pollId,
      voterId,
      choices: rows.flatMap((row) =>
        row.position === null ? [] : [row.position],
      ),
      castAt: first.cast_at,
    };
  }

  async voteHistory(
    voterId: string,
    limit: number,
    before?: VoteBefore,
  ): Promise<HistoryVote[]> {
    // The page is cut in the subquery, in vote_history_idx order, so the scan
    // stops at limit + 1; only those rows are joined to their polls.
    const { rows } = await this.#pool.query<{
      poll_id: string;
      cast_at: Date;
      question: string | null;
      closes_at: Date | null;
      ballot: number[];
      labels: string[];
    }>(
      "select v.poll_id, v.cast_at, p.question, p.closes_at," +
        " coalesce(array_agg(c.position order by c.position)" +
        " filter (where c.position is not null), '{}') as ballot," +
        " coalesce(array_agg(c.label order by c.position)" +
        " filter (where c.position is not null), '{}') as labels" +
        " from (select id, poll_id, cast_at from vote" +
        " where voter_id = $1" +
        ' and ($2::timestamptz is null or (cast_at, poll_id collate "C")' +
        ' < ($2::timestamptz, $3::text collate "C"))' +
        ' order by cast_at desc, poll_id collate "C" desc limit $4) v' +
        " left join polls p on p.id = v.poll_id" +
        " left join vote_choice vc on vc.vote_id = v.id" +
        " left join poll_choice c on c.id = vc.choice_id and c.poll_id = v.poll_id" +
        " group by v.id, v.poll_id, v.cast_at, p.question, p.closes_at" +
        ' order by v.cast_at desc, v.poll_id collate "C" desc',
      [voterId, before?.castAt ?? null, before?.pollId ?? null, limit + 1],
    );
    return rows.map((row) => ({
      pollId: row.poll_id,
      castAt: row.cast_at,
      ballot: row.ballot,
      ...(row.question === null
        ? {}
        : {
            poll: {
              question: row.question,
              choices: row.labels,
              ...(row.closes_at ? { closesAt: row.closes_at } : {}),
            },
          }),
    }));
  }

  async results(pollId: string): Promise<Results> {
    const poll = await this.#requirePoll(pollId);
    // One snapshot for every number, or a cast landing between them could
    // report more choices picked than people who voted.
    const { voters, counts, confirmed } = await inTransaction(
      this.#pool,
      async (client) => {
        const people = await client.query<{ voters: number }>(
          "select count(*)::int as voters from vote where poll_id = $1",
          [pollId],
        );
        const picked = await client.query<{ position: number; count: number }>(
          "select c.position, count(*)::int as count from vote_choice vc" +
            " join vote v on v.id = vc.vote_id" +
            " join poll_choice c on c.id = vc.choice_id" +
            " where v.poll_id = $1 and c.poll_id = $1" +
            " group by c.position",
          [pollId],
        );
        const counts = new Array<number>(poll.choices.length).fill(0);
        for (const row of picked.rows) counts[row.position] = row.count;
        return {
          voters: only(people.rows).voters,
          counts,
          confirmed: await confirmedTally(client, poll),
        };
      },
      "begin isolation level repeatable read read only",
    );
    return resultsFor(poll, voters, counts, confirmed.voters, confirmed.counts);
  }

  async #requirePoll(pollId: string): Promise<Poll> {
    const poll = await this.getPoll(pollId);
    if (!poll) throw new UnknownPollError(pollId);
    return poll;
  }
}

/**
 * The poll's picture columns, read beside the poll by a left join on
 * `polls.image_id`. `hidden` is the poll's own flag.
 */
const IMAGE_COLUMNS =
  "p.hidden, p.image_id, i.owner_kind as image_owner_kind," +
  " i.owner_id as image_owner_id, i.alt as image_alt," +
  " i.width as image_width, i.height as image_height";

interface ImageColumns {
  hidden: boolean;
  image_id: string | null;
  image_owner_kind: OwnerKind | null;
  image_owner_id: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
}

/**
 * The poll's picture, only when `mayServe` would serve it, so a body never
 * names a picture its route refuses. The alt text is set whenever a picture
 * is attached (`image_pending_or_attached`).
 */
function pollImageOf(
  row: { id: string } & ImageColumns,
): PollImage | undefined {
  if (row.image_id === null) return undefined;
  const served = mayServe(
    {
      id: row.image_id,
      ownerKind: row.image_owner_kind,
      ownerId: row.image_owner_id,
    },
    { kind: "poll", currentImageId: row.image_id, visible: !row.hidden },
  );
  // mayServe checks the owner kind; the owner id must also be this poll.
  if (!served || row.image_owner_id !== row.id) return undefined;
  if (
    row.image_alt === null ||
    row.image_width === null ||
    row.image_height === null
  )
    return undefined;
  return {
    id: row.image_id,
    width: row.image_width,
    height: row.image_height,
    alt: row.image_alt,
  };
}

interface PollRow extends ImageColumns {
  id: string;
  question: string;
  method: string;
  created_at: Date;
  closes_at: Date | null;
  accepts_suggestions: boolean;
  attribution_kind: string | null;
  author_name: string | null;
  community_id: string | null;
  community_label: string | null;
}

/**
 * An authored poll's public facts from its row, or undefined for a seed or
 * legacy poll. `polls_attribution_check` (005) guarantees an authored row has
 * a community and a well-formed kind/name pair; the label is the community
 * table's, the same row the Postgres creation store answers with. A row that
 * breaks those guarantees is refused rather than published half-credited.
 */
function publicationOf(row: PollRow): Publication | undefined {
  if (row.attribution_kind === null) return undefined;
  if (row.community_id === null || row.community_label === null)
    throw new Error("authored poll has no community");
  const community = { id: row.community_id, label: row.community_label };
  if (row.attribution_kind === "anonymous")
    return { community, attribution: { kind: "anonymous" } };
  if (row.attribution_kind === "named" && row.author_name !== null)
    return {
      community,
      attribution: { kind: "named", name: row.author_name },
    };
  throw new Error("authored poll has an unknown attribution");
}

interface ChoiceRow {
  label: string;
  next_poll_id: string | null;
}

/**
 * The confirmed half of a poll's results (ADR-0040), read on the caller's
 * connection so it shares `results()`'s snapshot.
 *
 * One confirmed vote per code — per person per poll — and it is that person's
 * most recently cast vote. The tie-break on equal times is `moreRecent`'s in
 * store.ts, byte order (`collate "C"`), so both stores pick the same vote.
 */
async function confirmedTally(
  client: PoolClient,
  poll: Poll,
): Promise<{ voters: number; counts: number[] }> {
  const latest =
    "select distinct on (confirmation) id from vote" +
    " where poll_id = $1 and confirmation is not null" +
    ' order by confirmation, cast_at desc, voter_id collate "C" desc';
  const people = await client.query<{ n: number }>(
    `select count(*)::int as n from (${latest}) as latest`,
    [poll.id],
  );
  const picked = await client.query<{ position: number; count: number }>(
    `with latest as (${latest})` +
      " select c.position, count(*)::int as count from vote_choice vc" +
      " join latest on latest.id = vc.vote_id" +
      " join poll_choice c on c.id = vc.choice_id" +
      " where c.poll_id = $1" +
      " group by c.position",
    [poll.id],
  );
  const counts = new Array<number>(poll.choices.length).fill(0);
  for (const row of picked.rows) counts[row.position] = row.count;
  return { voters: only(people.rows).n, counts };
}

/**
 * Takes one person's vote lock until the transaction ends (ADR-0046). The key
 * goes as text: `pg` sends a bigint parameter no other way.
 */
async function lockPerson(client: PoolClient, lockKey: bigint): Promise<void> {
  await client.query("select pg_advisory_xact_lock($1::bigint)", [
    lockKey.toString(),
  ]);
}

/** For statements that always return exactly one row. */
function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected exactly one row");
  return row;
}
