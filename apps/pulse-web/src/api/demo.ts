import type {
  Ballot,
  CastOutcome,
  Me,
  Poll,
  PollMethod,
  PulseApi,
  RequestLinkResult,
  Results,
} from "./types.js";

export interface DemoOptions {
  poll: {
    id: string;
    question: string;
    choices: string[];
    method: PollMethod;
    closesAt?: string | null;
    open?: boolean;
  };
  allowedDomain: string;
  community: string;
  /** Invented per-choice standings, one entry per choice. */
  otherVotes: number[];
  /**
   * How many people those standings represent. Under `approval` a person may
   * appear in several entries, so the count cannot be derived by summing —
   * doing that made shares total 100%, which is exactly what approval results
   * must not do. Defaults to the sum, which is correct for `single`.
   */
  otherVoters?: number;
}

/**
 * An in-browser stand-in for the API, so the client runs, demos, and can be
 * judged before the server exists. Everything lives in memory and dies on
 * reload — this is for looking at the product, never for counting real votes.
 *
 * It is held to the same behaviour the server promises: a vote can be changed,
 * approval ballots hold several choices but still count as one voter, and a
 * closed poll refuses to take one.
 */
export class DemoPulseApi implements PulseApi {
  readonly #poll: Poll;
  readonly #allowedDomain: string;
  readonly #community: string;
  readonly #others: number[];
  readonly #otherVoters: number;
  #pending: { email: string; wantsProofEmails: boolean } | null = null;
  #me: Me | null = null;
  #ballot: Ballot | null = null;

  constructor(options: DemoOptions) {
    this.#poll = {
      id: options.poll.id,
      question: options.poll.question,
      choices: options.poll.choices,
      method: options.poll.method,
      closesAt: options.poll.closesAt ?? null,
      open: options.poll.open ?? true,
    };
    this.#allowedDomain = options.allowedDomain.trim().toLowerCase();
    this.#community = options.community;
    this.#others = options.otherVotes;
    this.#otherVoters =
      options.otherVoters ?? options.otherVotes.reduce((a, b) => a + b, 0);
  }

  async requestLink(
    email: string,
    wantsProofEmails: boolean,
  ): Promise<RequestLinkResult> {
    const at = email.lastIndexOf("@");
    const domain =
      at === -1
        ? ""
        : email
            .slice(at + 1)
            .trim()
            .toLowerCase();
    if (domain !== this.#allowedDomain) {
      return {
        status: "not_eligible",
        message: `This story is open to people with a ${this.#allowedDomain} address.`,
      };
    }
    // Held, not signed in: the link still has to be redeemed, same as the server.
    this.#pending = { email, wantsProofEmails };
    return { status: "sent" };
  }

  /**
   * There is no mailbox here, so any non-empty token stands for "the link in
   * the email was clicked". An empty one is refused exactly as the server
   * refuses it — that is the case a screen can actually hit, by opening the
   * redeem page with no token in the URL.
   */
  async redeem(token: string): Promise<Me> {
    if (token.trim() === "") throw new Error("that link is incomplete");
    if (!this.#pending) throw new Error("ask for a link first");
    this.#me = {
      id: "demo-voter",
      community: this.#community,
      email: this.#pending.email,
    };
    return this.#me;
  }

  async me(): Promise<Me | null> {
    return this.#me;
  }

  /** Signed out, but the vote stays cast — same as the server. */
  async signOut(): Promise<void> {
    this.#me = null;
    this.#pending = null;
  }

  async poll(): Promise<Poll> {
    return this.#poll;
  }

  async myBallot(): Promise<Ballot | null> {
    return this.#ballot;
  }

  async results(): Promise<Results> {
    const counts = this.#others.map(
      (n, i) => n + (this.#ballot?.includes(i) ? 1 : 0),
    );
    // Voters, not selections: an approval ballot is still one person.
    const voters = this.#otherVoters + (this.#ballot ? 1 : 0);
    return {
      pollId: this.#poll.id,
      question: this.#poll.question,
      method: this.#poll.method,
      voters,
      choices: this.#poll.choices.map((label, index) => ({
        index,
        label,
        count: counts[index] ?? 0,
        share:
          voters === 0
            ? 0
            : Math.round(((counts[index] ?? 0) / voters) * 1000) / 10,
      })),
    };
  }

  async cast(_pollId: string, ballot: Ballot): Promise<CastOutcome> {
    if (!this.#poll.open) return { status: "closed" };
    const changed = this.#ballot !== null;
    this.#ballot = [...ballot].sort((a, b) => a - b);
    return {
      status: changed ? "changed" : "counted",
      ballot: this.#ballot,
      results: await this.results(),
    };
  }
}
