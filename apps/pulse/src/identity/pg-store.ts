import type { Pool } from "pg";
import { inTransaction } from "../db/transaction.js";
import type { AllowedDomain, AllowedDomainSource } from "./allowlist.js";
import { parseAssurance, type CredentialKind } from "./assurance.js";
import {
  CredentialTakenError,
  emailOf,
  voterWith,
  type ClaimStore,
  type Credential,
  type NewVoter,
  type PendingClaim,
  type Voter,
  type VoterStore,
} from "./store.js";

/**
 * Identity on Postgres: voters, the credentials they hold, outstanding sign-in
 * links, and the domains that name a community. Held to the same conformance
 * suites as the in-memory stores (`test/conformance/voter-store.ts`,
 * `claim-store.ts`).
 *
 * Every timestamp is one the caller passed in; nothing here asks the database
 * for the time (ADR-0021).
 */

/** The columns `voter` itself holds. Its address lives in `voter_credential`. */
const VOTER_ROW_COLUMNS =
  "id, community, assurance, claimed_at, proof_emails_opt_in," +
  " sessions_valid_from, session_generation";

/**
 * A voter's address, read from their `email` credential. One today; were there
 * ever several, the first proved is the one shown, so the answer never depends
 * on the order rows happen to come back in. Null for a voter with none.
 */
const EMAIL_OF_VOTER =
  "(select c.value from voter_credential c" +
  " where c.voter_id = voter.id and c.kind = 'email'" +
  " order by c.verified_at, c.value limit 1) as email";

const VOTER_COLUMNS = `${VOTER_ROW_COLUMNS}, ${EMAIL_OF_VOTER}`;

export class PostgresVoterStore implements VoterStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async byCredential(
    kind: CredentialKind,
    value: string,
  ): Promise<Voter | undefined> {
    return this.#one(
      `select ${VOTER_COLUMNS} from voter` +
        " join voter_credential held on held.voter_id = voter.id" +
        " where held.kind = $1 and held.value = $2",
      [kind, value],
    );
  }

  async byId(id: string): Promise<Voter | undefined> {
    return this.#one(`select ${VOTER_COLUMNS} from voter where id = $1`, [id]);
  }

  async create(voter: NewVoter, credential: Credential): Promise<Voter> {
    try {
      // One transaction: a voter whose credential is refused is never left
      // behind as a voter with none. Nothing creates one of those on purpose
      // yet (ADR-0032), so one appearing here would be this method's fault.
      await inTransaction(this.#pool, async (client) => {
        await client.query(
          `insert into voter (${VOTER_ROW_COLUMNS})` +
            " values ($1, $2, $3, $4, $5, $6, $7)",
          [
            voter.id,
            voter.community,
            voter.assurance,
            voter.claimedAt,
            voter.proofEmailsOptIn,
            voter.sessionsValidFrom ?? null,
            voter.sessionGeneration ?? 0,
          ],
        );
        await client.query(
          "insert into voter_credential" +
            " (kind, value, voter_id, params, verified_at)" +
            " values ($1, $2, $3, $4, $5)",
          [
            credential.kind,
            credential.value,
            voter.id,
            JSON.stringify(credential.params ?? {}),
            credential.verifiedAt,
          ],
        );
      });
    } catch (error) {
      // "This person already has a voter" is decided by the credential,
      // whichever key the database happened to check first — the voter row is
      // written first, so a repeat of both id and credential reports the id.
      // A clash on the id alone is a different fault and is not dressed up as
      // that. Two creates racing for one credential: the loser waits on the
      // winner's uncommitted key and fails on it once the winner commits, so
      // by the time this reads, the winner's credential is there to find.
      if (
        isUniqueViolation(error) &&
        (await this.byCredential(credential.kind, credential.value))
      ) {
        throw new CredentialTakenError(credential.kind);
      }
      throw error;
    }
    return voterWith(voter, emailOf(credential));
  }

  async setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined> {
    return this.#one(
      "update voter set proof_emails_opt_in = $2 where id = $1" +
        ` returning ${VOTER_COLUMNS}`,
      [id, optIn],
    );
  }

  async advanceSessionGeneration(id: string): Promise<Voter | undefined> {
    return this.#one(
      "update voter set session_generation = session_generation + 1 where id = $1" +
        ` returning ${VOTER_COLUMNS}`,
      [id],
    );
  }

  async #one(sql: string, values: unknown[]): Promise<Voter | undefined> {
    const { rows } = await this.#pool.query<VoterRow>(sql, values);
    const row = rows[0];
    return row ? toVoter(row) : undefined;
  }
}

const CLAIM_COLUMNS =
  "token_hash, kind, subject, community, proof_emails_opt_in, created_at," +
  " expires_at, used_at";

export class PostgresClaimStore implements ClaimStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async put(claim: PendingClaim): Promise<void> {
    await this.#pool.query(
      `insert into pending_claim (${CLAIM_COLUMNS})` +
        " values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        claim.tokenHash,
        claim.kind,
        claim.subject,
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

  async discard(tokenHash: string): Promise<void> {
    // `used_at is null` in the statement, not checked first: a click that
    // spends the link between a read and a delete must win.
    await this.#pool.query(
      "delete from pending_claim where token_hash = $1 and used_at is null",
      [tokenHash],
    );
  }

  async liveFor(
    kind: CredentialKind,
    subject: string,
    now: Date,
  ): Promise<readonly PendingClaim[]> {
    // `expires_at > now`: a link expiring exactly now is expired, as
    // ClaimService reads it (`expiresAt <= now` refuses).
    const { rows } = await this.#pool.query<ClaimRow>(
      `select ${CLAIM_COLUMNS} from pending_claim` +
        " where kind = $1 and subject = $2 and used_at is null" +
        " and expires_at > $3 order by created_at",
      [kind, subject, now],
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
    // 'Student.UBC.ca' must still match ada@student.ubc.ca. Tabs and line
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
 * Let a domain name a community: addresses at it sign in as members of it
 * (ADR-0030 — every other address still signs in, with no community). Normalised as
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
  email: string | null;
  community: string | null;
  assurance: string;
  claimed_at: Date;
  proof_emails_opt_in: boolean;
  sessions_valid_from: Date | null;
  session_generation: string;
}

interface ClaimRow {
  token_hash: string;
  kind: string;
  subject: string;
  community: string | null;
  proof_emails_opt_in: boolean;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

// Optional fields are left out when the column is null, never set to
// undefined — the shape the in-memory stores hand back. `community` and
// `email` are not optional: they are always present, and null is their value
// for no community and no address.

function toVoter(row: VoterRow): Voter {
  const generation = Number(row.session_generation);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("stored session generation is out of range");
  }
  const voter: Voter = {
    id: row.id,
    email: row.email,
    community: row.community,
    assurance: parseAssurance(row.assurance),
    claimedAt: row.claimed_at,
    proofEmailsOptIn: row.proof_emails_opt_in,
  };
  return {
    ...voter,
    ...(row.sessions_valid_from
      ? { sessionsValidFrom: row.sessions_valid_from }
      : {}),
    ...(generation ? { sessionGeneration: generation } : {}),
  };
}

function toClaim(row: ClaimRow): PendingClaim {
  const claim: PendingClaim = {
    tokenHash: row.token_hash,
    kind: credentialKind(row.kind),
    subject: row.subject,
    community: row.community,
    proofEmailsOptIn: row.proof_emails_opt_in,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  return row.used_at ? { ...claim, usedAt: row.used_at } : claim;
}

/** A stored kind this build does not know is refused, not guessed at. */
function credentialKind(word: string): CredentialKind {
  if (word !== "email") {
    throw new Error(`unknown credential kind: ${JSON.stringify(word)}`);
  }
  return word;
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
