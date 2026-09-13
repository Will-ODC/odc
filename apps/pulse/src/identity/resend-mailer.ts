/**
 * Sending pulse's mail through Resend (ADR-0027).
 *
 * Resend's send is one `POST /emails` with a bearer token and a JSON body, so
 * this talks to it with `fetch` rather than an SDK — a dependency for one
 * request is a dependency to audit, update and eventually replace, and it would
 * make the provider harder to change rather than easier.
 *
 * `ConsoleMailer` is still what development uses. The provider is a deployment
 * detail; this file is the only thing in pulse that knows the word "Resend".
 */
import { MailRejectedError, MailSendError, type Mailer } from "./mailer.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Long enough for a slow provider, short enough that nobody waits on a dead one.
 *
 * Exported so a test can pin the judgement. A test that actually waited the
 * default out would cost the default on every run, so what is asserted is the
 * bound rather than the number.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResendConfig {
  apiKey: string;
  /** The From header, e.g. `pulse <sign-in@your-domain.org>`. A verified sender. */
  from: string;
  /** Where replies go, when that should not be the From address. */
  replyTo?: string;
}

export interface ResendOptions {
  /** Test seam. The real one is the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * Read the provider configuration from the environment.
 *
 * Returns `undefined` when no key is set, which is the ordinary case in
 * development and is the caller's cue to use `ConsoleMailer`. A key set
 * **without** a From address throws instead, at startup: a half-configured
 * mailer that starts and then fails on the first sign-in is a worse failure
 * than one that refuses to boot, because the person who sees it is not the
 * person who set the variable.
 *
 * Both names are pulse-owned. Nothing is read from a bare `RESEND_API_KEY`, for
 * the reason `src/db/config.ts` records about `DATABASE_URL`: a widely exported
 * name aims pulse at whatever the developer already had configured, and here
 * that means sending real mail from somebody else's account.
 */
export function resendConfig(
  env: Record<string, string | undefined> = process.env,
): ResendConfig | undefined {
  const apiKey = trimmed(env["PULSE_RESEND_API_KEY"]);
  if (apiKey === undefined) return undefined;

  const from = trimmed(env["PULSE_MAIL_FROM"]);
  if (from === undefined) {
    throw new Error(
      "PULSE_RESEND_API_KEY is set but PULSE_MAIL_FROM is not. " +
        "Set the address mail is sent from, e.g. " +
        '"pulse <sign-in@your-domain.org>".',
    );
  }

  const replyTo = trimmed(env["PULSE_MAIL_REPLY_TO"]);
  return { apiKey, from, ...(replyTo === undefined ? {} : { replyTo }) };
}

/** An empty or whitespace-only value is unset, exactly as in `db/config.ts`. */
function trimmed(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export class ResendMailer implements Mailer {
  readonly #config: ResendConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(config: ResendConfig, options: ResendOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = options.endpoint ?? RESEND_ENDPOINT;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendClaimLink(to: string, link: string): Promise<void> {
    const safeLink = escapeHtml(link);
    await this.#send({
      to,
      subject: "Your sign-in link for pulse",
      // The link is repeated as text under the button on purpose: a mail client
      // that strips the anchor, or a person forwarding this to the device they
      // actually read on, still has something to work with.
      html:
        `<p>Here is your link to sign in to pulse.</p>` +
        `<p><a href="${safeLink}">Sign in</a></p>` +
        `<p>Or paste this into your browser:<br>${safeLink}</p>` +
        `<p>The link works for 15 minutes and once only. ` +
        `If you did not ask for it, you can ignore this email.</p>`,
      text: [
        "Here is your link to sign in to pulse.",
        "",
        link,
        "",
        "The link works for 15 minutes and once only.",
        "If you did not ask for it, you can ignore this email.",
      ].join("\n"),
    });
  }

  async sendProofOfAction(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    await this.#send({
      to,
      subject,
      // The body is caller-supplied prose, so it is escaped before it becomes
      // markup — nothing in it should ever be read as a tag.
      html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
      text: body,
    });
  }

  async #send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.#config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(this.#config.replyTo === undefined
            ? {}
            : { reply_to: this.#config.replyTo }),
        }),
        // Without this a provider that accepts the connection and then says
        // nothing holds the sign-in request open for as long as it likes.
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      // A refused connection, a DNS failure, the timeout above. None of them is
      // a fault in pulse, so none of them is allowed to reach the 500 handler.
      throw new MailSendError("the mail provider could not be reached", {
        cause,
      });
    }

    if (response.ok) return;

    // The provider's own words, for the log only. They are never shown to the
    // person signing in: a 422 naming an unverified sending domain is an
    // operator's problem and reads to anyone else as gibberish about pulse.
    const explanation =
      `the mail provider refused the message (${response.status}): ` +
      (await bodyText(response));

    // Which kind of refusal this is decides whether anyone ever finds out.
    // Busy or broken, and trying again is the right advice; anything else is a
    // deployment fault that will refuse identically forever, so it stays a
    // fault and keeps its 500 rather than being dressed as an outage.
    if (isTransient(response.status)) {
      throw new MailSendError(explanation, { status: response.status });
    }
    throw new MailRejectedError(explanation, response.status);
  }
}

/**
 * Is trying again the right advice?
 *
 * 408 and 429 say the provider is busy, 5xx says it is broken. Every other
 * refusal — 400, 401, 403, 404, 422 — is pulse's key, payload or sending domain
 * and does not improve by being repeated.
 */
function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Never let a failure to read the error body replace the error. */
async function bodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
