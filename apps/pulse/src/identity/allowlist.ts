import type { EmailAddress } from "./email.js";

/**
 * Which community an address belongs to, decided by data rather than code.
 *
 * **A label, not a gate** (ADR-0030). Anyone with a working address may sign
 * in; these rows only decide which community, if any, they are recorded under.
 * An address no row matches signs in with no community.
 *
 * Adding a community, or another email domain to one, must be an insert —
 * never a deploy. That is why the rows are the whole configuration and why
 * nothing here hardcodes a domain.
 */
export interface AllowedDomain {
  /** The community this domain proves membership of, e.g. "ubc-students". */
  community: string;
  /** Lowercase domain, e.g. "student.ubc.ca". */
  domain: string;
  /**
   * When true, subdomains count too: `student.ubc.ca` would also match
   * `cs.student.ubc.ca`. Off by default — widening reach should be a decision
   * someone made, not something a row does silently.
   */
  includeSubdomains?: boolean;
}

/** The answer to "is this address a member, and of what?". */
export interface Membership {
  community: string;
  /** The row that named their community, useful for showing why. */
  via: AllowedDomain;
}

/**
 * How an address proves membership. Email domain is the only method today;
 * invite codes and vouching by an existing member are the expected next ones,
 * and they plug in here without any caller changing.
 *
 * **Not the same question as a credential's `kind`** (`./assurance.ts`,
 * ADR-0033), and deliberately not a third word for it. A credential answers
 * "who is this person, and how sure are we" — its kind is the assurance level
 * it confers. A verification method answers "which community, if any" — it
 * reads a credential the person already proved (today, always an `email` one,
 * which is why `memberships` takes an address) and never decides whether they may
 * sign in (ADR-0030). A later vouching method would read a vouching
 * credential the same way, and an invite code would be a method with no
 * credential kind of its own.
 */
export interface VerificationMethod {
  /**
   * Every community this address proves membership of, or none — which since
   * ADR-0030 means "no community", not "may not sign in". Two or more is a
   * question for the person, never for this method: it does not pick
   * (ADR-0023). Sorted by community so a list shown to someone reads the same
   * every time; the order is display only and decides nothing.
   */
  memberships(email: EmailAddress): Promise<readonly Membership[]>;
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
 * When rows of different specificity match — a subdomain rule and an exact
 * rule, say — only the most specific level counts, so a narrower row can
 * always be added to carve out a community without rewriting the broader one.
 *
 * **One domain may serve several communities.** `allowed_domain` is keyed on
 * `(community, domain)`, deliberately (ADR-0023), so two communities can both
 * claim `ubc.ca` and both rows match the same address at the same length.
 * Both are returned, and the person picks at sign-in (P2,
 * `ClaimService.requestLink`). There used to be an interim tie-break here —
 * longest domain, then lowest community alphabetically — and `check` returned
 * its one winner. It was removed with the picker because nothing else called
 * it, and an arbitrary single answer left lying around is exactly what decides
 * where someone's question is posted without asking them (ADR-0024).
 */
export class DomainAllowlist implements VerificationMethod {
  readonly #source: AllowedDomainSource;

  constructor(source: AllowedDomainSource) {
    this.#source = source;
  }

  async memberships(email: EmailAddress): Promise<readonly Membership[]> {
    const matches = (await this.#source.rows()).filter((row) =>
      matches_(row, email.domain),
    );
    if (matches.length === 0) return [];

    const longest = Math.max(...matches.map((row) => row.domain.length));
    const byCommunity = new Map<string, AllowedDomain>();
    for (const row of matches) {
      // At one length, two rows naming one community can only be an exact row
      // and a subdomain row for the same domain; either explains it.
      if (row.domain.length === longest && !byCommunity.has(row.community)) {
        byCommunity.set(row.community, row);
      }
    }
    return [...byCommunity.values()]
      .sort((a, b) =>
        a.community < b.community ? -1 : a.community > b.community ? 1 : 0,
      )
      .map((row) => ({ community: row.community, via: row }));
  }
}

function matches_(row: AllowedDomain, domain: string): boolean {
  if (row.domain === domain) return true;
  return row.includeSubdomains === true && domain.endsWith(`.${row.domain}`);
}
