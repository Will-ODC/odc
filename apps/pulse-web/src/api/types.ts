/**
 * What the client expects the pulse API to speak.
 *
 * Written from the UI's needs, deliberately ahead of the server in two places
 * the product has already decided on:
 *
 *  - `method` — a poll says how it is answered. `single` and `approval` today;
 *    `ranked` is the reason a ballot is an array rather than one number, so
 *    adding it later changes no shape here.
 *  - a vote can be **changed** until the poll closes. `castVote` is therefore
 *    idempotent-by-replacement, and `changed` is a normal outcome, not an error.
 */

export type PollMethod = "single" | "approval";

export interface Poll {
  id: string;
  question: string;
  /** Ordered; a ballot references positions in this array, never the text. */
  choices: string[];
  method: PollMethod;
  /** ISO timestamp, or null when the poll has no closing time. */
  closesAt: string | null;
  open: boolean;
}

/** One person's answer. Always an array — one entry for `single`. */
export type Ballot = number[];

export interface ChoiceResult {
  index: number;
  label: string;
  count: number;
  /** Percentage. For `approval` these do not sum to 100, and shouldn't. */
  share: number;
}

export interface Results {
  pollId: string;
  question: string;
  method: PollMethod;
  choices: ChoiceResult[];
  /** People who voted — not the number of selections made. */
  voters: number;
}

export type CastOutcome =
  | { status: "counted"; ballot: Ballot; results: Results }
  | { status: "changed"; ballot: Ballot; results: Results }
  | { status: "closed" };

/**
 * The signed-in person, in the server's own field names (`GET /api/me` →
 * `{ voter: { id, email, community } }`). `id`, not `voterId`: one name for one
 * thing, so nothing has to be renamed on the way in or out.
 */
export interface Me {
  id: string;
  community: string;
  /** The address the link was sent to, shown back so a typo is obvious. */
  email: string;
}

export interface PulseApi {
  /**
   * Ask for a sign-in link. `wantsProofEmails` is the opt-in for hearing what
   * came of the vote — the server's own name for it, and a real boolean either
   * way, because it refuses anything else rather than reading it as false.
   */
  requestLink(
    email: string,
    wantsProofEmails: boolean,
  ): Promise<RequestLinkResult>;
  /** Redeem the token from the emailed link. */
  redeem(token: string): Promise<Me>;
  me(): Promise<Me | null>;
  /**
   * Sign out everywhere, not only in this browser: every session issued before
   * now stops working. Resolves once the server has done it.
   */
  signOut(): Promise<void>;
  poll(pollId: string): Promise<Poll>;
  myBallot(pollId: string): Promise<Ballot | null>;
  results(pollId: string): Promise<Results>;
  cast(pollId: string, ballot: Ballot): Promise<CastOutcome>;
}

/**
 * Two answers, because the server gives two: the link is on its way, or the
 * address's domain belongs to no community yet. There is no `devLink`
 * variant — no implementation can produce one (the server never returns a link
 * in a response body), and a variant nothing can produce is a lie in the type.
 *
 * `message` on `not_eligible` is the server's own sentence, which names the
 * domain. It is shown as-is.
 */
export type RequestLinkResult =
  { status: "sent" } | { status: "not_eligible"; message: string };

/**
 * How every implementation of `PulseApi` reports a refusal.
 *
 * It lives here, beside the shapes, because it is part of what the client
 * expects the API to speak: a screen writes one
 * `catch (err) { if (err instanceof ApiError) … }` and it must hold whether it
 * is talking to the server or to the in-browser demo. `status` mirrors the
 * HTTP status the server would send; `message` is the plain sentence to show.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's machine-readable `error` slug, when it sent one.
   *
   * Kept deliberately narrow: callers show `message`, never this. It exists so
   * the one refusal the UI has to *treat differently* — `not_a_member`, which
   * is an answer to "can I take part?" rather than a fault — can be told apart
   * from every other 403 without matching on a sentence.
   */
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
