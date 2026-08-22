/**
 * Storage for identity. Interfaces first, in-memory implementations second; the
 * Postgres versions replace the classes and leave the claim flow untouched.
 */

/** A person who claimed an identity. `id` is what the voting core counts. */
export interface Voter {
  id: string;
  /** Normalized address — the natural key. One voter per address. */
  email: string;
  community: string;
  claimedAt: Date;
  /** Opt-in, asked at registration. Nothing is sent when false. */
  proofEmailsOptIn: boolean;
  /**
   * Sessions issued before this moment no longer count. Signing out moves it to
   * now, which is what makes signing out mean something on every device rather
   * than only on the one that clicked.
   */
  sessionsValidFrom?: Date;
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
  community: string;
  proofEmailsOptIn: boolean;
  createdAt: Date;
  expiresAt: Date;
  /** Set the moment it is redeemed. A link works exactly once. */
  usedAt?: Date;
}

export interface VoterStore {
  byEmail(email: string): Promise<Voter | undefined>;
  byId(id: string): Promise<Voter | undefined>;
  create(voter: Voter): Promise<Voter>;
  /** Change the opt-in. The one field about a voter that is theirs to change. */
  setProofEmails(id: string, optIn: boolean): Promise<Voter | undefined>;
  /** Sign out everywhere: every session issued before `at` stops working. */
  invalidateSessionsBefore(id: string, at: Date): Promise<Voter | undefined>;
}

export interface ClaimStore {
  put(claim: PendingClaim): Promise<void>;
  byTokenHash(tokenHash: string): Promise<PendingClaim | undefined>;
  markUsed(tokenHash: string, usedAt: Date): Promise<void>;
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
      throw new Error(`a voter already exists for ${voter.email}`);
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

  async invalidateSessionsBefore(
    id: string,
    at: Date,
  ): Promise<Voter | undefined> {
    const voter = this.#byId.get(id);
    if (!voter) return undefined;
    const updated: Voter = { ...voter, sessionsValidFrom: at };
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

  async markUsed(tokenHash: string, usedAt: Date): Promise<void> {
    const claim = this.#claims.get(tokenHash);
    if (claim) this.#claims.set(tokenHash, { ...claim, usedAt });
  }

  async liveFor(email: string, now: Date): Promise<readonly PendingClaim[]> {
    return [...this.#claims.values()].filter(
      (c) => c.email === email && c.usedAt === undefined && c.expiresAt > now,
    );
  }
}
