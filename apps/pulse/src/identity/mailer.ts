/**
 * Sending email. One interface, so the provider is a deployment detail rather
 * than something the claim flow knows about.
 *
 * Two messages exist in pulse and no others: the link that claims an identity,
 * and the proof of what happened after a vote. Anything else would be mail
 * nobody asked for.
 */
export interface Mailer {
  /** The magic link. `link` is the full URL the person clicks. */
  sendClaimLink(to: string, link: string): Promise<void>;
  /** What came of the vote they took part in. Only ever to people opted in. */
  sendProofOfAction(to: string, subject: string, body: string): Promise<void>;
}

/**
 * The provider would not take the message.
 *
 * This is the one failure a `Mailer` is expected to have, so it is named rather
 * than left as a bare `Error`: a provider being down is not a bug in pulse, and
 * the sign-in route answers it as a refusal a person can retry rather than as a
 * fault (ADR-0027). Anything else a mailer throws is a fault and keeps its 500.
 */
export class MailSendError extends Error {
  /** The provider's status code, when it answered with one. */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "MailSendError";
    this.status = options.status;
  }
}

/**
 * Development sender: prints instead of sending, and keeps what it printed.
 *
 * This is what makes the whole claim flow testable and demonstrable before any
 * provider account exists — the link is on your terminal, you paste it into the
 * browser, and the flow is the real one. Swapping in a provider later changes
 * nothing but which Mailer is constructed.
 */
export class ConsoleMailer implements Mailer {
  readonly sent: SentMessage[] = [];
  readonly #log: (message: string) => void;

  constructor(log: (message: string) => void = console.log) {
    this.#log = log;
  }

  async sendClaimLink(to: string, link: string): Promise<void> {
    this.sent.push({ kind: "claim-link", to, body: link });
    this.#log(`\n  pulse — sign-in link for ${to}\n  ${link}\n`);
  }

  async sendProofOfAction(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    this.sent.push({ kind: "proof-of-action", to, subject, body });
    this.#log(`\n  pulse — "${subject}" to ${to}\n  ${body}\n`);
  }

  /** The most recent message sent to an address, for tests and local poking. */
  lastTo(address: string): SentMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === address);
  }
}

export interface SentMessage {
  kind: "claim-link" | "proof-of-action";
  to: string;
  subject?: string;
  body: string;
}
