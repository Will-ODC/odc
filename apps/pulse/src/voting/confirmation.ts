import { createHmac } from "node:crypto";

/**
 * The shortest confirmation key accepted. The code's whole protection is that
 * nobody without the key can recompute it, so a short or guessable key would
 * let anyone holding a copy of the database work out who voted what — which
 * is the one thing this key exists to prevent (ADR-0040). 32 characters is
 * what `openssl rand -base64 24` prints; `openssl rand -base64 32` is better.
 */
export const MIN_CONFIRMATION_KEY_LENGTH = 32;

/**
 * Labels the input so a code made here can never equal an HMAC of the same
 * key made for some other purpose, and so a later scheme can be told apart.
 */
const DOMAIN = "pulse-vote-confirmation/v1";

/**
 * Turns "this account confirmed a vote on this poll" into a one-way code
 * (ADR-0040).
 *
 * A confirmed vote stores this code and never the account id or the address.
 * The code is the same every time for one account on one poll, which is what
 * lets pulse count one confirmed vote per person per poll; it differs between
 * polls, so codes cannot be matched across polls; and without the key nobody
 * can compute it from an account id, so a copy of the database alone does not
 * show who voted what. **The holder of the key can**: compute the code for
 * every account and look for it. Pulse accepts that (operator decision,
 * 2026-10-12); full separation is the core ledger's job.
 *
 * The key is held in a private field, so it is not enumerable and never
 * appears in `JSON.stringify`, `util.inspect` or a log line of this object.
 */
export class ConfirmationKey {
  readonly #key: string;

  constructor(key: string) {
    if (key.length < MIN_CONFIRMATION_KEY_LENGTH) {
      // The key itself is never part of the message.
      throw new Error(
        `the confirmation key must be at least ${MIN_CONFIRMATION_KEY_LENGTH} characters`,
      );
    }
    this.#key = key;
  }

  /**
   * The code for one account on one poll: HMAC-SHA256, lowercase hex.
   *
   * The input is a JSON array, which is length-unambiguous: no pair of ids can
   * encode the same as another pair, whatever characters they hold. A plain
   * separator could collide across the boundary (`("a", "b:c")` and
   * `("a:b", "c")`).
   */
  codeFor(accountId: string, pollId: string): string {
    return createHmac("sha256", this.#key)
      .update(JSON.stringify([DOMAIN, accountId, pollId]))
      .digest("hex");
  }
}
