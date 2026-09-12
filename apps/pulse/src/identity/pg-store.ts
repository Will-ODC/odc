import type { Pool } from "pg";
import type { AllowedDomain, AllowedDomainSource } from "./allowlist.js";
import {
  VoterExistsError,
  type ClaimStore,
  type PendingClaim,
  type Voter,
  type VoterStore,
} from "./store.js";

/**
 * Identity on Postgres: voters, outstanding sign-in links, and the domains
 * that prove membership. Held to the same conformance suites as the in-memory
 * stores (`test/conformance/voter-store.ts`, `claim-store.ts`).
 *
 * Every timestamp is one the caller passed in; nothing here asks the database
 * for the time (ADR-0021).
 */

const VOTER_COLUMNS =
  "id, email, community, claimed_at, proof_emails_opt_in, sessions_valid_from";

export class PostgresVoterStore implements VoterStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async byEmail(email: string): Promise<Voter | undefined> {
    return this.#one(`select ${VOTER_COLUMNS} from voter where email = $1`, [
      email,
    ]);
  }

  async byId(id: string): Promise<Voter | undefined> {
    return this.#one(`select ${VOTER_COLUMNS} from voter where id = $1`, [id]);
  }

  async create(voter: Voter): Promise<Voter> {
    try {
      await this.#pool.query(
        `insert into voter (${VOTER_COLUMNS}) values ($1, $2, $3, $4, $5, $6)`,
        [
          voter.id,
          voter.email,
          voter.community,
          voter.claimedAt,
          voter.proofEmailsOptIn,
          voter.sessionsValidFrom ?? null,
        ],
      );
    } catch (error) {
      // "This person already has a voter" is decided by the address, whichever
      // key the database happened to check first — a repeat of both id and
      // address reports the id. A clash on the id alone is a different fault
      // and is not dressed up as that.
      if (isUniqueViolation(error) && (await this.byEmail(voter.email))) {
        throw new VoterExistsError(voter.email);
      }
      throw error;
    }
    return voter;
  }

  async setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined> {
    return this.#one(
      "update voter set proof_emails_opt_in = $2 where id = $1" +
        ` returning ${VOTER_COLUMNS}`,
      [id, optIn],
    );
  }

  async invalidateSessionsBefore(
    id: string,
    at: Date,
  ): Promise<Voter | undefined> {
    return this.#one(
      "update voter set sessions_valid_from = $2 where id = $1" +
        ` returning ${VOTER_COLUMNS}`,
      [id, at],
    );
  }

  async #one(sql: string, values: unknown[]): Promise<Voter | undefined> {
    const { rows } = await this.#pool.query<VoterRow>(sql, values);
    const row = rows[0];
    return row ? toVoter(row) : undefined;
  }
}

const CLAIM_COLUMNS =
  "token_hash, email, community, proof_emails_opt_in, created_at," +
  " expires_at, used_at";

export class PostgresClaimStore implements ClaimStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async put(claim: PendingClaim): Promise<void> {
    await this.#pool.query(
      `insert into pending_claim (${CLAIM_COLUMNS})` +
        " values ($1, $2, $3, $4, $5, $6, $7)",
      [
        claim.tokenHash,
        claim.email,
        claim.community,
        claim.proofEmailsOptIn,
        claim.createdAt,
        claim.expiresAt,
        claim.usedAt ?? null,
      ],
    );
  }

  async byTokenHash(tokenHash: string): Promise<PendingClaim | undefined> {
    const { rows } = await this.#pool.query<ClaimRow>(
      `select ${CLAIM_COLUMNS} from pending_claim where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    return row ? toClaim(row) : undefined;
  }

  async markUsed(tokenHash: string, usedAt: Date): Promise<boolean> {
    // Check and spend in one statement: of two clicks at once, the row lock
    // lets exactly one see `used_at is null`.
    const { rowCount } = await this.#pool.query(
      "update pending_claim set used_at = $2" +
        " where token_hash = $1 and used_at is null",
      [tokenHash, usedAt],
    );
    return rowCount === 1;
  }

  async liveFor(email: string, now: Date): Promise<readonly PendingClaim[]> {
    // `expires_at > now`: a link expiring exactly now is expired, as
    // ClaimService reads it (`expiresAt <= now` refuses).
    const { rows } = await this.#pool.query<ClaimRow>(
      `select ${CLAIM_COLUMNS} from pending_claim` +
        " where email = $1 and used_at is null and expires_at > $2" +
        " order by created_at",
      [email, now],
    );
    return rows.map(toClaim);
  }
}

/**
 * The allowlist, as the rows `CLAUDE.md` promises it is: adding a community's
 * domain is an insert (`allowDomain`), never a deploy.
 */
export class PostgresDomainSource implements AllowedDomainSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async rows(): Promise<readonly AllowedDomain[]> {
    // Normalised on the way out, as StaticDomainSource normalises on the way
    // in: the allowlist is managed by inserts, and a row typed by hand as
    // 'Student.UBC.ca' must still admit ada@student.ubc.ca. Tabs and line
    // breaks are stripped too, as JavaScript's trim() strips them; SQL's
    // trim() alone takes only spaces. The order only makes the list read the
    // same each time; nothing depends on it.
    const { rows } = await this.#pool.query<{
      community: string;
      domain: string;
      include_subdomains: boolean;
    }>(
      "select community, lower(btrim(domain, E' \\t\\r\\n')) as domain," +
        " include_subdomains from allowed_domain order by community, domain",
    );
    return rows.map((row) => ({
      community: row.community,
      domain: row.domain,
      includeSubdomains: row.include_subdomains,
    }));
  }
}

/**
 * Let a domain prove membership of a community. Normalised as
 * `StaticDomainSource` normalises — trimmed and lowercase — and idempotent on
 * the `(community, domain)` key, so a seed can run it on every boot.
 */
export async function allowDomain(
  pool: Pool,
  row: AllowedDomain,
): Promise<void> {
  await pool.query(
    "insert into allowed_domain (community, domain, include_subdomains)" +
      " values ($1, $2, $3)" +
      " on conflict (community, domain)" +
      " do update set include_subdomains = excluded.include_subdomains",
    [
      row.community,
      row.domain.trim().toLowerCase(),
      row.includeSubdomains === true,
    ],
  );
}

interface VoterRow {
  id: string;
  email: string;
  community: string;
  claimed_at: Date;
  proof_emails_opt_in: boolean;
  sessions_valid_from: Date | null;
}

interface ClaimRow {
  token_hash: string;
  email: string;
  community: string;
  proof_emails_opt_in: boolean;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

// Optional fields are left out when the column is null, never set to
// undefined — the shape the in-memory stores hand back.

function toVoter(row: VoterRow): Voter {
  const voter: Voter = {
    id: row.id,
    email: row.email,
    community: row.community,
    claimedAt: row.claimed_at,
    proofEmailsOptIn: row.proof_emails_opt_in,
  };
  return row.sessions_valid_from
    ? { ...voter, sessionsValidFrom: row.sessions_valid_from }
    : voter;
}

function toClaim(row: ClaimRow): PendingClaim {
  const claim: PendingClaim = {
    tokenHash: row.token_hash,
    email: row.email,
    community: row.community,
    proofEmailsOptIn: row.proof_emails_opt_in,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  return row.used_at ? { ...claim, usedAt: row.used_at } : claim;
}

/** Postgres's code for a unique violation. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
