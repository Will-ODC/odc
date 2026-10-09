/**
 * Storage for identity. Interfaces first, in-memory implementations second; the
 * Postgres versions replace the classes and leave the claim flow untouched.
 */

import type { Assurance, CredentialKind } from "./assurance.js";

/** A person who claimed an identity. `id` is what the voting core counts. */
export interface Voter {
  id: string;
  /**
   * The address of the voter's `email` credential, or `null` for a voter who
   * holds none. Since P8 (ADR-0032) the address is not the voter's key but a
   * credential they hold, read back here so `/api/me` keeps its shape.
   *
   * Every voter created today signs in by email and so has one. Null is the
   * deliberate room for a voter with no credential — a public-link or
   * anonymous voter (P10) — which nothing creates yet.
   */
  email: string | null;
  /**
   * The community their address's domain matched when they first signed in,
   * or `null` when it matched none (ADR-0030). Null, never an empty string or
   * a placeholder: having no community is an ordinary state, not a missing
   * value, and it reads back from every store exactly as it was written.
   */
  community: string | null;
  /** How sure pulse is of who they are (`./assurance.ts`). */
  assurance: Assurance;
  claimedAt: Date;
  /** Opt-in, asked at registration. Nothing is sent when false. */
  proofEmailsOptIn: boolean;
  /** Legacy column retained in the forward-only schema; no longer authorizes sessions. */
  sessionsValidFrom?: Date;
  /** Monotonic revocation counter. Zero for voters created before migration. */
  sessionGeneration?: number;
}

/** A voter as it is written: its address comes from its credential instead. */
export type NewVoter = Omit<Voter, "email">;

/**
 * Something a voter has proved — today, that they hold an address. One
 * `(kind, value)` belongs to at most one voter: that is what makes one address
 * one person.
 */
export interface Credential {
  kind: CredentialKind;
  /** For `email`, the normalized address. */
  value: string;
  /** When it was proved. Supplied by the caller, like every pulse timestamp. */
  verifiedAt: Date;
  /** What a later kind needs to remember — who vouched, say. Empty today. */
  params?: Readonly<Record<string, unknown>>;
}

/**
 * An outstanding magic link.
 *
 * The token itself is never stored — only its SHA-256. Someone reading the
 * table therefore cannot sign in as anyone; they would need the raw token,
 * which exists only in the email that was sent.
 */
export interface PendingClaim {
  tokenHash: string;
  /** The kind of credential this link proves when it is clicked. */
  kind: CredentialKind;
  /** What it proves: for `email`, the normalized address it was sent to. */
  subject: string;
  /** Decided when the link is asked for; `null` for no community (ADR-0030). */
  community: string | null;
  proofEmailsOptIn: boolean;
  createdAt: Date;
  expiresAt: Date;
  /** Set the moment it is redeemed. A link works exactly once. */
  usedAt?: Date;
}

/**
 * Thrown by `VoterStore.create` when the credential already belongs to a
 * voter. Named, because two first sign-ins for one address can race — two
 * links clicked at once — and the one that loses recovers by reading the
 * winner's voter.
 */
export class CredentialTakenError extends Error {
  constructor(kind: CredentialKind, value: string) {
    super(`a voter already holds the ${kind} credential ${value}`);
    this.name = "CredentialTakenError";
  }
}

export interface VoterStore {
  /** The voter holding this credential, if anyone does. */
  byCredential(kind: CredentialKind, value: string): Promise<Voter | undefined>;
  byId(id: string): Promise<Voter | undefined>;
  /**
   * Write a voter and its first credential, both or neither. Throws
   * `CredentialTakenError` when the credential already belongs to a voter —
   * and then no voter has been written.
   */
  create(voter: NewVoter, credential: Credential): Promise<Voter>;
  /** Change the opt-in. The one field about a voter that is theirs to change. */
  setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined>;
  /** Atomically revoke every session in the current generation. */
  advanceSessionGeneration(id: string): Promise<Voter | undefined>;
}

export interface ClaimStore {
  put(claim: PendingClaim): Promise<void>;
  byTokenHash(tokenHash: string): Promise<PendingClaim | undefined>;
  /**
   * Spend a link: record `usedAt` and return true — or return false, changing
   * nothing, when it was already spent or does not exist. Checking and
   * spending are one step, so two clicks at once cannot both spend it.
   */
  markUsed(tokenHash: string, usedAt: Date): Promise<boolean>;
  /** Outstanding, unexpired links for one subject — used to throttle requests. */
  liveFor(
    kind: CredentialKind,
    subject: string,
    now: Date,
  ): Promise<readonly PendingClaim[]>;
  /**
   * Forget a link nobody can ever hold: its email was refused by the provider,
   * so it never left pulse. It stops counting against the address's live-link
   * cap (P4a). A link already spent is kept — "already used" is what a second
   * click must hear — and an unknown hash changes nothing.
   */
  discard(tokenHash: string): Promise<void>;
}

/** The address a credential gives its voter: only an `email` one gives one. */
export function emailOf(credential: Credential): string | null {
  return credential.kind === "email" ? credential.value : null;
}

export class InMemoryVoterStore implements VoterStore {
  readonly #byId = new Map<string, NewVoter>();
  /** `kind`, `value` -> voter id: the uniqueness `voter_credential` keys on. */
  readonly #holder = new Map<string, string>();
  /** voter id -> the address of their email credential. */
  readonly #email = new Map<string, string>();

  async byCredential(
    kind: CredentialKind,
    value: string,
  ): Promise<Voter | undefined> {
    const id = this.#holder.get(credentialKey(kind, value));
    return id === undefined ? undefined : this.#read(id);
  }

  async byId(id: string): Promise<Voter | undefined> {
    return this.#read(id);
  }

  async create(voter: NewVoter, credential: Credential): Promise<Voter> {
    // Both checks before either write, so a refusal leaves nothing behind.
    const key = credentialKey(credential.kind, credential.value);
    if (this.#holder.has(key)) {
      throw new CredentialTakenError(credential.kind, credential.value);
    }
    // The id is the voter everywhere else: a second voter under it would
    // leave the first address signing in as someone else.
    if (this.#byId.has(voter.id)) {
      throw new Error(`a voter already has the id ${voter.id}`);
    }
    const row = voter;
    this.#byId.set(voter.id, row);
    this.#holder.set(key, voter.id);
    const email = emailOf(credential);
    if (email !== null) this.#email.set(voter.id, email);
    return { ...row, email };
  }

  async setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined> {
    const voter = this.#byId.get(id);
    if (!voter) return undefined;
    this.#byId.set(id, { ...voter, proofEmailsOptIn: optIn });
    return this.#read(id);
  }

  async advanceSessionGeneration(id: string): Promise<Voter | undefined> {
    const voter = this.#byId.get(id);
    if (!voter) return undefined;
    this.#byId.set(id, {
      ...voter,
      sessionGeneration: (voter.sessionGeneration ?? 0) + 1,
    });
    return this.#read(id);
  }

  #read(id: string): Voter | undefined {
    const row = this.#byId.get(id);
    return row ? { ...row, email: this.#email.get(id) ?? null } : undefined;
  }
}

/** JSON of the pair, so no choice of value can collide with another pair. */
function credentialKey(kind: CredentialKind, value: string): string {
  return JSON.stringify([kind, value]);
}

/** The voter a store hands back: the row, with the address its credential gave. */
export function voterWith(voter: NewVoter, email: string | null): Voter {
  return { ...voter, email };
}

export class InMemoryClaimStore implements ClaimStore {
  readonly #claims = new Map<string, PendingClaim>();

  async put(claim: PendingClaim): Promise<void> {
    this.#claims.set(claim.tokenHash, claim);
  }

  async byTokenHash(tokenHash: string): Promise<PendingClaim | undefined> {
    return this.#claims.get(tokenHash);
  }

  async markUsed(tokenHash: string, usedAt: Date): Promise<boolean> {
    const claim = this.#claims.get(tokenHash);
    if (!claim || claim.usedAt !== undefined) return false;
    this.#claims.set(tokenHash, { ...claim, usedAt });
    return true;
  }

  async discard(tokenHash: string): Promise<void> {
    if (this.#claims.get(tokenHash)?.usedAt === undefined) {
      this.#claims.delete(tokenHash);
    }
  }

  async liveFor(
    kind: CredentialKind,
    subject: string,
    now: Date,
  ): Promise<readonly PendingClaim[]> {
    return [...this.#claims.values()].filter(
      (c) =>
        c.kind === kind &&
        c.subject === subject &&
        c.usedAt === undefined &&
        c.expiresAt > now,
    );
  }
}
