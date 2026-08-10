import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { VerificationMethod } from "./allowlist.js";
import { InvalidEmailError, parseEmail } from "./email.js";
import type { Mailer } from "./mailer.js";
import type { ClaimStore, PendingClaim, Voter, VoterStore } from "./store.js";

/** What came of asking for a sign-in link. */
export type RequestResult =
  | { status: "sent"; expiresAt: Date }
  | { status: "invalid_email"; reason: string }
  | { status: "not_a_member"; domain: string }
  | { status: "too_many_requests" };

/** What a link is worth, without spending it. */
export type InspectResult =
  | { status: "live"; email: string; expiresAt: Date }
  | { status: "expired" }
  | { status: "already_used" }
  | { status: "unknown_link" };

/** What came of clicking one. */
export type RedeemResult =
  | { status: "signed_in"; voter: Voter; firstTime: boolean }
  | { status: "expired" }
  | { status: "already_used" }
  | { status: "unknown_link" };

export interface ClaimOptions {
  /** How long a link works. Short enough to matter, long enough to find the mail. */
  linkTtlMs?: number;
  /** Outstanding links one address may hold at once. */
  maxLiveLinksPerEmail?: number;
  clock?: () => Date;
  /** Test seam. Real tokens come from the system's CSPRNG. */
  newToken?: () => string;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Claiming an identity in pulse: enter an email, click the link it sends, and
 * you can vote. There is no password, because there is nothing here worth
 * protecting with one — the email itself is the whole proof, and the domain it
 * belongs to is what proves membership of a community.
 */
export class ClaimService {
  readonly #membership: VerificationMethod;
  readonly #voters: VoterStore;
  readonly #claims: ClaimStore;
  readonly #mailer: Mailer;
  readonly #linkFor: (token: string) => string;
  readonly #ttlMs: number;
  readonly #maxLive: number;
  readonly #clock: () => Date;
  readonly #newToken: () => string;

  constructor(
    deps: {
      membership: VerificationMethod;
      voters: VoterStore;
      claims: ClaimStore;
      mailer: Mailer;
      /** Builds the URL that lands someone back here holding the token. */
      linkFor: (token: string) => string;
    },
    options: ClaimOptions = {},
  ) {
    this.#membership = deps.membership;
    this.#voters = deps.voters;
    this.#claims = deps.claims;
    this.#mailer = deps.mailer;
    this.#linkFor = deps.linkFor;
    this.#ttlMs = options.linkTtlMs ?? FIFTEEN_MINUTES;
    this.#maxLive = options.maxLiveLinksPerEmail ?? 3;
    this.#clock = options.clock ?? (() => new Date());
    this.#newToken =
      options.newToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async requestLink(
    rawEmail: string,
    opts: { wantsProofEmails?: boolean } = {},
  ): Promise<RequestResult> {
    let email;
    try {
      email = parseEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError)
        return { status: "invalid_email", reason: err.message };
      throw err;
    }

    const membership = await this.#membership.check(email);
    // Said plainly rather than hidden: the allowlist is public information, and
    // "your school isn't set up yet" is a more useful answer than silence.
    if (!membership) return { status: "not_a_member", domain: email.domain };

    const now = this.#clock();
    const live = await this.#claims.liveFor(email.value, now);
    if (live.length >= this.#maxLive) return { status: "too_many_requests" };

    const token = this.#newToken();
    const claim: PendingClaim = {
      tokenHash: hashToken(token),
      email: email.value,
      community: membership.community,
      wantsProofEmails: opts.wantsProofEmails ?? false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.#ttlMs),
    };
    await this.#claims.put(claim);
    await this.#mailer.sendClaimLink(email.value, this.#linkFor(token));

    return { status: "sent", expiresAt: claim.expiresAt };
  }

  /**
   * Report whether a link is still good, without spending it.
   *
   * Mail scanners and prefetchers follow every URL in an email. If merely
   * fetching a link consumed it, the person would arrive to find it already
   * used — so the page that opens asks this, and only the click redeems.
   */
  async inspect(token: string): Promise<InspectResult> {
    const claim = await this.#claims.byTokenHash(hashToken(token));
    if (!claim) return { status: "unknown_link" };
    if (claim.usedAt !== undefined) return { status: "already_used" };
    if (claim.expiresAt <= this.#clock()) return { status: "expired" };
    return { status: "live", email: claim.email, expiresAt: claim.expiresAt };
  }

  /**
   * Redeem a link. This both creates the identity the first time and signs the
   * same person back in every time after — one door, so there is no separate
   * "sign up" and "log in" for anyone to be confused by.
   */
  async redeem(token: string): Promise<RedeemResult> {
    const claim = await this.#claims.byTokenHash(hashToken(token));
    if (!claim) return { status: "unknown_link" };

    const now = this.#clock();
    // Used before expired: a link someone already clicked should say so, even
    // if it has since aged out.
    if (claim.usedAt !== undefined) return { status: "already_used" };
    if (claim.expiresAt <= now) return { status: "expired" };

    await this.#claims.markUsed(claim.tokenHash, now);

    const existing = await this.#voters.byEmail(claim.email);
    if (existing) {
      // An opt-in given on a later request is honoured; it is never silently
      // turned back off by someone signing in again.
      const voter =
        claim.wantsProofEmails && !existing.wantsProofEmails
          ? ((await this.#voters.setProofEmails(existing.id, true)) ?? existing)
          : existing;
      return { status: "signed_in", voter, firstTime: false };
    }

    const voter = await this.#voters.create({
      id: randomUUID(),
      email: claim.email,
      // The community recorded at claim time. If the allowlist changes later,
      // an existing member does not lose the community they joined.
      community: claim.community,
      claimedAt: now,
      wantsProofEmails: claim.wantsProofEmails,
    });
    return { status: "signed_in", voter, firstTime: true };
  }
}

/**
 * Only the digest is ever stored, so a leaked claims table cannot be used to
 * sign in as anyone. Tokens carry 256 bits of entropy, which is why a plain
 * hash is enough here and no salt or slow KDF is needed.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
