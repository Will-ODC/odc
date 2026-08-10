import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed-in cookie.
 *
 * A cookie carries the voter id and an HMAC of it under a server secret. There
 * is no session table: nothing about a session is worth storing, and a stateless
 * cookie means signing in survives a restart. The trade is that signing someone
 * out everywhere means rotating the secret — acceptable while pulse has no
 * account settings to protect.
 */
export const SESSION_COOKIE = "pulse_session";

/** 30 days. Long enough that voting in a later story does not mean another email. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export class SessionSigner {
  readonly #secret: string;

  constructor(secret: string) {
    if (secret.length < 16) {
      throw new Error("session secret must be at least 16 characters");
    }
    this.#secret = secret;
  }

  /** `<voterId>.<signature>` — the cookie's whole value. */
  sign(voterId: string): string {
    return `${voterId}.${this.#mac(voterId)}`;
  }

  /** The voter id a cookie proves, or undefined if it proves nothing. */
  verify(cookie: string | undefined): string | undefined {
    if (!cookie) return undefined;
    const dot = cookie.lastIndexOf(".");
    if (dot <= 0) return undefined;

    const voterId = cookie.slice(0, dot);
    const presented = Buffer.from(cookie.slice(dot + 1), "utf8");
    const expected = Buffer.from(this.#mac(voterId), "utf8");
    // Equal-length check first: timingSafeEqual throws on a length mismatch.
    if (presented.length !== expected.length) return undefined;
    return timingSafeEqual(presented, expected) ? voterId : undefined;
  }

  #mac(voterId: string): string {
    return createHmac("sha256", this.#secret)
      .update(voterId, "utf8")
      .digest("base64url");
  }
}
