import { createHash, randomBytes, randomUUID } from "node:crypto";
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
   * (ADR-0027), which means the provider's explanation reaches nobody unless
   * something writes it down here. Without it, a revoked key or an unverified
   * sending domain refuses every sign-in forever and looks exactly like a
   * passing outage — and the one person who could fix it is told to try again.
   */
  log?: (message: string, error: unknown) => void;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

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
  readonly #log: (message: string, error: unknown) => void;

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
    this.#log =
      options.log ??
      ((message, error) => {
        console.error(message, error);
      });
  }

  async requestLink(
    rawEmail: string,
    opts: { proofEmailsOptIn?: boolean } = {},
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
    const membership = await this.#membership.check(email);
    const community = membership?.community ?? null;

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
      // Not a fault does not mean not worth knowing. This is the only place the
      // provider's own explanation exists, and the person who sees the 503
      // cannot act on it.
      this.#log("pulse: a sign-in link could not be sent", error);
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
          this.#log(
            "pulse: a refused sign-in link could not be discarded",
            discardError,
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
    if (!claim) return { status: "unknown_link" };
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
    const claim = await this.#claims.byTokenHash(hashToken(token));
    if (!claim) return { status: "unknown_link" };

    const now = this.#clock();
    // Used before expired: a link someone already clicked should say so, even
    // if it has since aged out.
    if (claim.usedAt !== undefined) return { status: "already_used" };
    if (claim.expiresAt <= now) return { status: "expired" };

    // The checks above read the link before any concurrent click could mark
    // it. Spending is one step that says whether THIS request spent it, so a
    // second click that got this far is told here instead of signed in twice.
    if (!(await this.#claims.markUsed(claim.tokenHash, now))) {
      return { status: "already_used" };
    }

    const existing = await this.#voters.byCredential(claim.kind, claim.subject);
    if (existing) return this.#signInExisting(existing, claim);

    try {
      // The voter and the credential the link just proved, written together
      // (ADR-0032): the address is something this voter holds, not what the
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
