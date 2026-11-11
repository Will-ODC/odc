import { createHash, randomBytes, randomUUID } from "node:crypto";
import { logFault, type Fault } from "../logging.js";
import type { VerificationMethod } from "./allowlist.js";
import { assuranceOf } from "./assurance.js";
import { InvalidEmailError, parseEmail } from "./email.js";
import { MailSendError, type Mailer } from "./mailer.js";
import {
  CredentialTakenError,
  type ClaimStore,
  type PendingClaim,
  type Voter,
  type VoterStore,
} from "./store.js";

/** What came of asking for a sign-in link. */
export type RequestResult =
  | { status: "sent"; expiresAt: Date }
  | { status: "invalid_email"; reason: string }
  /**
   * The address proves several communities and no pick came with it. Nothing
   * was sent and no claim exists: ask the person, then ask again with one.
   */
  | { status: "choose_community"; communities: readonly string[] }
  /** A pick came with it that this address does not prove. Nothing sent. */
  | { status: "unknown_community" }
  | { status: "too_many_requests" }
  | { status: "send_failed" };

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
  /**
   * Where a mail provider's refusal goes.
   *
   * A failed send is answered to the person as a refusal they can retry
   * (ADR-0027). Only its class and HTTP status may be logged (#503): a provider
   * reply, error message or cause can quote a person's address or live link.
   */
  log?: (message: string, fault: Fault) => void;
}

export const LINK_TTL_MS = 15 * 60 * 1000;
/**
 * Replay markers outlive a link by this much to absorb clock and request lag.
 * The margin only keeps the "already used" wording stable: single use is
 * enforced by the atomic pending-row delete in `markUsed`, not by this marker.
 */
export const USED_CLAIM_MARGIN_MS = 5 * 60 * 1000;

/**
 * Claiming an identity in pulse: enter an email, click the link it sends, and
 * you can vote. There is no password, because there is nothing here worth
 * protecting with one — the email itself is the whole proof.
 *
 * **Anyone with a working address gets in** (ADR-0030). The domain decides
 * only which community, if any, the person is recorded under: a domain that
 * matches a row in the allowlist names that community, and any other address
 * signs in with none. Nothing here turns an address away for its domain.
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
  readonly #log: (message: string, fault: Fault) => void;

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
    this.#ttlMs = options.linkTtlMs ?? LINK_TTL_MS;
    this.#maxLive = options.maxLiveLinksPerEmail ?? 3;
    this.#clock = options.clock ?? (() => new Date());
    this.#newToken =
      options.newToken ?? (() => randomBytes(32).toString("base64url"));
    this.#log =
      options.log ??
      ((message, error) => {
        console.error(message, error);
      });
  }

  /**
   * Ask for a sign-in link.
   *
   * `community` is the person's pick (ADR-0023, P2). It is needed only when
   * the address proves two or more communities; with one or none the answer
   * is the same with or without it. When it is given, it must be one the
   * address proves, at any count — a pick is never quietly dropped, because
   * the person would then be signed in somewhere other than where they asked.
   */
  async requestLink(
    rawEmail: string,
    opts: { proofEmailsOptIn?: boolean; community?: string } = {},
  ): Promise<RequestResult> {
    let email;
    try {
      email = parseEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError)
        return { status: "invalid_email", reason: err.message };
      throw err;
    }

    // A label, not a gate (ADR-0030): no matching row means no community,
    // never a refusal. Null rather than an empty string or a placeholder, so
    // "no community" cannot be mistaken for a community called "".
    const proven = (await this.#membership.memberships(email)).map(
      (m) => m.community,
    );
    let community: string | null;
    if (opts.community !== undefined) {
      if (!proven.includes(opts.community)) {
        return { status: "unknown_community" };
      }
      community = opts.community;
    } else if (proven.length > 1) {
      // The person picks (ADR-0023). Asked before the throttle and before any
      // claim is written, so being asked costs them none of their live links.
      return { status: "choose_community", communities: proven };
    } else {
      community = proven[0] ?? null;
    }

    const now = this.#clock();
    const live = await this.#claims.liveFor("email", email.value, now);
    if (live.length >= this.#maxLive) return { status: "too_many_requests" };

    const token = this.#newToken();
    const claim: PendingClaim = {
      tokenHash: hashToken(token),
      kind: "email",
      subject: email.value,
      community,
      proofEmailsOptIn: opts.proofEmailsOptIn ?? false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.#ttlMs),
    };
    await this.#claims.put(claim);
    const link = this.#linkFor(token);
    try {
      await this.#mailer.sendClaimLink(email.value, link);
    } catch (error) {
      // The provider being down is not a fault in pulse, and telling someone
      // "check your email" for mail that is never coming is the one answer
      // worse than saying nothing (ADR-0027). Anything a mailer throws that is
      // NOT this is a real fault and keeps its 500 — a rejected key or an
      // unverified sending domain among them.
      if (!(error instanceof MailSendError)) throw error;
      // Record only safe diagnostics; the provider's reply can contain the
      // person's address or sign-in link (#503).
      logFault(
        ({ fault }, message) => this.#log(message, fault),
        error,
        "pulse: a sign-in link could not be sent",
      );
      // When the provider says it never took the message, no email exists and
      // nobody can hold this link: forget it, or it counts against
      // `maxLiveLinksPerEmail` and the next request after the outage is told
      // "a link is already on its way" — which is false (P4a).
      //
      // Any other failure may hide a delivery: a timeout or dropped connection
      // (no status at all), or a 500/502/504 from a gateway that gave up after
      // Resend had already accepted. Discarding there would break a link
      // already in the inbox, so the claim stays and expires on its own.
      if (neverAccepted(error)) {
        try {
          await this.#claims.discard(claim.tokenHash);
        } catch (discardError) {
          // Freeing the cap is best-effort. The person still hears the 503
          // and its "try again"; the claim expires on its own.
          logFault(
            ({ fault }, message) => this.#log(message, fault),
            discardError,
            "pulse: a refused sign-in link could not be discarded",
          );
        }
      }
      return { status: "send_failed" };
    }

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
    if (!claim)
      return {
        status: (await this.#claims.wasUsed(hashToken(token)))
          ? "already_used"
          : "unknown_link",
      };
    if (claim.usedAt !== undefined) return { status: "already_used" };
    if (claim.expiresAt <= this.#clock()) return { status: "expired" };
    return { status: "live", email: claim.subject, expiresAt: claim.expiresAt };
  }

  /**
   * Redeem a link. This both creates the identity the first time and signs the
   * same person back in every time after — one door, so there is no separate
   * "sign up" and "log in" for anyone to be confused by.
   */
  async redeem(token: string): Promise<RedeemResult> {
    const hash = hashToken(token);
    const claim = await this.#claims.byTokenHash(hash);
    const now = this.#clock();
    // Read this claim first so an expired link still receives the documented
    // `expired` answer while its row, and every other expired row, is removed.
    // The sweep is housekeeping: a failure in it must never turn a valid
    // sign-in into an error, so it is logged and the redeem carries on.
    try {
      await this.#purgeExpired(now);
    } catch (purgeError) {
      logFault(
        ({ fault }, message) => this.#log(message, fault),
        purgeError,
        "pulse: expired sign-in links could not be removed",
      );
    }
    if (!claim)
      return {
        status: (await this.#claims.wasUsed(hash))
          ? "already_used"
          : "unknown_link",
      };

    // Used before expired: a link someone already clicked should say so, even
    // if it has since aged out.
    if (claim.usedAt !== undefined) return { status: "already_used" };
    if (claim.expiresAt <= now) return { status: "expired" };

    // A successful spend deletes the pending address and leaves only a hash
    // marker. This atomic check must still succeed after the read above: a
    // competing click or expiry sweep may already have removed the row.
    if (!(await this.#claims.markUsed(claim.tokenHash, now))) {
      return { status: "already_used" };
    }

    const existing = await this.#voters.byCredential(claim.kind, claim.subject);
    if (existing) return this.#signInExisting(existing, claim);

    try {
      // The voter and the credential the link just proved, written together
      // (ADR-0033): the address is something this voter holds, not what the
      // voter is. Clicking a mailed link is `email` assurance.
      const voter = await this.#voters.create(
        {
          id: randomUUID(),
          // The community recorded at claim time, null included. If the
          // allowlist changes later, an existing member does not lose the
          // community they joined.
          community: claim.community,
          assurance: assuranceOf(claim.kind),
          claimedAt: now,
          proofEmailsOptIn: claim.proofEmailsOptIn,
        },
        { kind: claim.kind, value: claim.subject, verifiedAt: now },
      );
      return { status: "signed_in", voter, firstTime: true };
    } catch (error) {
      // Another link for this address was redeemed at the same moment and
      // created the voter first. This person IS that voter: sign them in.
      if (!(error instanceof CredentialTakenError)) throw error;
      const winner = await this.#voters.byCredential(claim.kind, claim.subject);
      if (!winner) throw error;
      return this.#signInExisting(winner, claim);
    }
  }

  /** Sweep claims using the same clock that creates and redeems links. */
  async purgeExpired(): Promise<void> {
    await this.#purgeExpired(this.#clock());
  }

  async #purgeExpired(now: Date): Promise<void> {
    await this.#claims.purgeExpired(
      now,
      new Date(now.getTime() - this.#ttlMs - USED_CLAIM_MARGIN_MS),
    );
  }

  async #signInExisting(
    existing: Voter,
    claim: PendingClaim,
  ): Promise<RedeemResult> {
    // An opt-in given on a later request is honoured; it is never silently
    // turned back off by someone signing in again.
    const voter =
      claim.proofEmailsOptIn && !existing.proofEmailsOptIn
        ? ((await this.#voters.setProofEmails(existing.id, true)) ?? existing)
        : existing;
    return { status: "signed_in", voter, firstTime: false };
  }
}

/**
 * Did the provider answer that it did not take the message?
 *
 * 408 (it timed out reading the request), 429 (it turned the request away)
 * and 503 (it is not taking requests) all come before acceptance. A 500, 502
 * or 504 can come from a gateway after the provider accepted, so it is not
 * proof that no email went out; neither is a failure with no status.
 */
function neverAccepted(error: MailSendError): boolean {
  return error.status === 408 || error.status === 429 || error.status === 503;
}

/**
 * Only the digest is ever stored, so a leaked claims table cannot be used to
 * sign in as anyone. Tokens carry 256 bits of entropy, which is why a plain
 * hash is enough here and no salt or slow KDF is needed.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
