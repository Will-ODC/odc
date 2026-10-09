/**
 * Storage for identity. Interfaces first, in-memory implementations second; the
 * Postgres versions replace the classes and leave the claim flow untouched.
 */

/** A person who claimed an identity. `id` is what the voting core counts. */
export interface Voter {
  id: string;
  /** Normalized address — the natural key. One voter per address. */
  email: string;
  /**
   * The community their address's domain matched when they first signed in,
   * or `null` when it matched none (ADR-0030). Null, never an empty string or
   * a placeholder: having no community is an ordinary state, not a missing
   * value, and it reads back from every store exactly as it was written.
   */
  community: string | null;
  claimedAt: Date;
  /** Opt-in, asked at registration. Nothing is sent when false. */
  proofEmailsOptIn: boolean;
  /** Legacy column retained in the forward-only schema; no longer authorizes sessions. */
  sessionsValidFrom?: Date;
  /** Monotonic revocation counter. Zero for voters created before migration. */
  sessionGeneration?: number;
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
  email: string;
  /** Decided when the link is asked for; `null` for no community (ADR-0030). */
  community: string | null;
  proofEmailsOptIn: boolean;
  createdAt: Date;
  expiresAt: Date;
  /** Set the moment it is redeemed. A link works exactly once. */
  usedAt?: Date;
}

/**
 * Thrown by `VoterStore.create` when the address already has a voter. Named,
 * because two first sign-ins for one address can race — two links clicked at
 * once — and the one that loses recovers by reading the winner's voter.
 */
export class VoterExistsError extends Error {
  constructor(email: string) {
    super(`a voter already exists for ${email}`);
    this.name = "VoterExistsError";
  }
}

export interface VoterStore {
  byEmail(email: string): Promise<Voter | undefined>;
  byId(id: string): Promise<Voter | undefined>;
  /** Throws `VoterExistsError` when the address already has a voter. */
  create(voter: Voter): Promise<Voter>;
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
  /** Outstanding, unexpired links for an address — used to throttle requests. */
  liveFor(email: string, now: Date): Promise<readonly PendingClaim[]>;
}

export class InMemoryVoterStore implements VoterStore {
  readonly #byId = new Map<string, Voter>();
  readonly #byEmail = new Map<string, string>();

  async byEmail(email: string): Promise<Voter | undefined> {
    const id = this.#byEmail.get(email);
    return id === undefined ? undefined : this.#byId.get(id);
  }

  async byId(id: string): Promise<Voter | undefined> {
    return this.#byId.get(id);
  }

  async create(voter: Voter): Promise<Voter> {
    if (this.#byEmail.has(voter.email)) {
      throw new VoterExistsError(voter.email);
    }
    // The id is the voter everywhere else: a second voter under it would
    // leave the first address signing in as someone else.
    if (this.#byId.has(voter.id)) {
      throw new Error(`a voter already has the id ${voter.id}`);
    }
    this.#byId.set(voter.id, voter);
    this.#byEmail.set(voter.email, voter.id);
    return voter;
  }

  async setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined> {
    const voter = this.#byId.get(id);
    if (!voter) return undefined;
    const updated: Voter = { ...voter, proofEmailsOptIn: optIn };
    this.#byId.set(id, updated);
    return updated;
  }

  async advanceSessionGeneration(id: string): Promise<Voter | undefined> {
    const voter = this.#byId.get(id);
    if (!voter) return undefined;
    const updated: Voter = {
      ...voter,
      sessionGeneration: (voter.sessionGeneration ?? 0) + 1,
    };
    this.#byId.set(id, updated);
    return updated;
  }
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

  async liveFor(email: string, now: Date): Promise<readonly PendingClaim[]> {
    return [...this.#claims.values()].filter(
      (c) => c.email === email && c.usedAt === undefined && c.expiresAt > now,
    );
  }
}
