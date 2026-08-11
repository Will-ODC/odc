import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed-in cookie.
 *
 * The cookie carries the voter id, when it was issued, when it expires, and an
 * HMAC over all three under a server secret. Everything the server needs is in
 * the cookie, so there is no session table to keep — but unlike a bare signed
 * id, this one actually stops working:
 *
 * - `exp` is checked on every request, so a stolen cookie is useless after it
 *   passes. A `Set-Cookie` max-age would not do this: that is a request to the
 *   browser, not something the server enforces.
 * - `iat` is what makes signing out real. A voter carries a `sessionsValidFrom`
 *   timestamp; sign-out moves it to now, and every cookie issued before that
 *   moment stops verifying — on every device, not just the one that clicked.
 *
 * Both timestamps are **milliseconds**, matching `sessionsValidFrom`. Seconds
 * would round `iat` down to the start of its second, so someone who signed out
 * at .400 and signed back in at .600 would be handed a cookie stamped .000 —
 * earlier than their own sign-out, and refused on the next request. Flooring
 * `sessionsValidFrom` instead only moves the hole to the other side, where
 * cookies from earlier in the same second survive a sign-out.
 */
export const SESSION_COOKIE = "pulse_session";

/** 30 days. Long enough that voting in a later story need not mean another email. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** What a valid cookie proves. */
export interface SessionClaims {
  voterId: string;
  /** When the cookie was issued. Compared against the voter's sign-out time. */
  issuedAt: Date;
  expiresAt: Date;
}

export class SessionSigner {
  readonly #secret: string;
  readonly #ttlSeconds: number;
  readonly #clock: () => Date;

  constructor(
    secret: string,
    options: { ttlSeconds?: number; clock?: () => Date } = {},
  ) {
    if (secret.length < 16) {
      throw new Error("session secret must be at least 16 characters");
    }
    this.#secret = secret;
    this.#ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
    this.#clock = options.clock ?? (() => new Date());
  }

  /** `<voterId>.<iat>.<exp>.<signature>` — the cookie's whole value. */
  sign(voterId: string): string {
    const iat = this.#clock().getTime();
    const exp = iat + this.#ttlSeconds * 1000;
    const payload = `${voterId}.${iat}.${exp}`;
    return `${payload}.${this.#mac(payload)}`;
  }

  /** What a cookie proves, or undefined if it proves nothing or has expired. */
  verify(cookie: string | undefined): SessionClaims | undefined {
    if (!cookie) return undefined;

    // Split from the right: the signature and the two timestamps are the last
    // three fields, so a voter id containing dots stays intact.
    const lastDot = cookie.lastIndexOf(".");
    const payload = cookie.slice(0, lastDot);
    if (!this.#macMatches(payload, cookie.slice(lastDot + 1))) return undefined;

    // No shape check on the split itself. A cookie whose payload is missing a
    // field cannot carry a matching MAC unless it came from here, and the field
    // checks below reject whatever such a split produces — an absent field
    // reads back as an empty voter id or a non-integer timestamp. A shape guard
    // here would be a branch no input could reach, which is a branch no test
    // could hold in place.
    const expDot = payload.lastIndexOf(".");
    const iatDot = payload.lastIndexOf(".", expDot - 1);

    const voterId = payload.slice(0, iatDot);
    const iat = Number(payload.slice(iatDot + 1, expDot));
    const exp = Number(payload.slice(expDot + 1));
    if (
      voterId === "" ||
      !Number.isSafeInteger(iat) ||
      !Number.isSafeInteger(exp)
    ) {
      return undefined;
    }

    const now = this.#clock().getTime();
    if (exp <= now) return undefined;

    return {
      voterId,
      issuedAt: new Date(iat),
      expiresAt: new Date(exp),
    };
  }

  /** Seconds until a freshly signed cookie expires, for the cookie's max-age. */
  get ttlSeconds(): number {
    return this.#ttlSeconds;
  }

  #macMatches(payload: string, presented: string): boolean {
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(this.#mac(payload), "utf8");
    // Equal-length check first: timingSafeEqual throws on a length mismatch.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  #mac(payload: string): string {
    return createHmac("sha256", this.#secret)
      .update(payload, "utf8")
      .digest("base64url");
  }
}
