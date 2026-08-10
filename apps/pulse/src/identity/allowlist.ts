import type { EmailAddress } from "./email.js";

/**
 * Who counts as a member of a community, decided by data rather than code.
 *
 * Adding a community, or letting another email domain into one, must be an
 * insert — never a deploy. That is why the rows are the whole configuration and
 * why nothing here hardcodes a domain.
 */
export interface AllowedDomain {
  /** The community this domain proves membership of, e.g. "ubc-students". */
  community: string;
  /** Lowercase domain, e.g. "student.ubc.ca". */
  domain: string;
  /**
   * When true, subdomains count too: `student.ubc.ca` would also admit
   * `cs.student.ubc.ca`. Off by default — widening reach should be a decision
   * someone made, not something a row does silently.
   */
  includeSubdomains?: boolean;
}

/** The answer to "is this address a member, and of what?". */
export interface Membership {
  community: string;
  /** The row that admitted them, useful for showing why they got in. */
  via: AllowedDomain;
}

/**
 * How an address proves membership. Email domain is the only method today;
 * invite codes and vouching by an existing member are the expected next ones,
 * and they plug in here without any caller changing.
 */
export interface VerificationMethod {
  /** The membership this address proves, or undefined if it proves none. */
  check(email: EmailAddress): Promise<Membership | undefined>;
}

/** Reads the allowlist rows. A table query later; an array today. */
export interface AllowedDomainSource {
  rows(): Promise<readonly AllowedDomain[]>;
}

export class StaticDomainSource implements AllowedDomainSource {
  readonly #rows: readonly AllowedDomain[];

  constructor(rows: readonly AllowedDomain[]) {
    this.#rows = rows.map((r) => ({
      ...r,
      domain: r.domain.trim().toLowerCase(),
    }));
  }

  async rows(): Promise<readonly AllowedDomain[]> {
    return this.#rows;
  }
}

/**
 * Membership by email domain.
 *
 * When several rows match — a subdomain rule and an exact rule, say — the most
 * specific one wins, so a narrower row can always be added to carve out a
 * community without rewriting the broader one.
 */
export class DomainAllowlist implements VerificationMethod {
  readonly #source: AllowedDomainSource;

  constructor(source: AllowedDomainSource) {
    this.#source = source;
  }

  async check(email: EmailAddress): Promise<Membership | undefined> {
    const matches = (await this.#source.rows()).filter((row) =>
      matches_(row, email.domain),
    );
    if (matches.length === 0) return undefined;

    const best = matches.reduce((a, b) =>
      b.domain.length > a.domain.length ? b : a,
    );
    return { community: best.community, via: best };
  }
}

function matches_(row: AllowedDomain, domain: string): boolean {
  if (row.domain === domain) return true;
  return row.includeSubdomains === true && domain.endsWith(`.${row.domain}`);
}
