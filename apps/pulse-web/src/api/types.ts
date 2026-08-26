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
  /**
   * The poll each choice opens next, position for position with `choices`, and
   * `null` where that choice ends the run. Answering is also navigating.
   */
  next: (string | null)[];
  /** Whether people may add options of their own to this poll. */
  acceptsSuggestions: boolean;
  /** ISO timestamp, or null when the poll has no closing time. */
  closesAt: string | null;
  open: boolean;
}

/**
 * An option someone added themselves.
 *
 * Not a choice on the ballot: choices are answered by position, so adding one
 * mid-poll would change what earlier ballots meant. Suggestions are counted on
 * their own, and nothing records who made one.
 */
export interface Suggestion {
  id: string;
  text: string;
  /** How many people have said something like it. */
  count: number;
}

/** A choice the poll already lists. Mirrors the server's `BallotChoice`. */
export interface BallotChoice {
  /** Position in `Poll.choices` — what a vote records. */
  index: number;
  label: string;
}

/**
 * What came of adding one. Near-duplicates are folded together and never
 * refused — `seconded` means someone had already said it and their wording
 * keeps the floor. `on_ballot` means the poll already offers it, so nothing
 * was added and the person is pointed at the choice they can vote for.
 * `related` is what came close without folding in, shown so a person can see
 * they are near an existing idea.
 */
export type SuggestResult =
  | {
      status: "added" | "seconded";
      suggestion: Suggestion;
      related: Suggestion[];
    }
  | { status: "on_ballot"; choice: BallotChoice; related: Suggestion[] };

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
   * Ask for a sign-in link. `proofEmailsOptIn` is the opt-in for hearing what
   * came of the vote — the server's own name for it, and a real boolean either
   * way, because it refuses anything else rather than reading it as false.
   */
  requestLink(
    email: string,
    proofEmailsOptIn: boolean,
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
  suggestions(pollId: string): Promise<Suggestion[]>;
  suggest(pollId: string, text: string): Promise<SuggestResult>;
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
  /** `message` is the server's own "check your email" sentence, when it sent one. */
  | { status: "sent"; message?: string }
  | { status: "not_eligible"; message: string };

/**
 * How every implementation of `PulseApi` reports a refusal.
 *
 * It lives here, beside the shapes, because it is part of what the client
 * expects the API to speak, not a detail of how one implementation talks: a
 * screen writes one `catch (err) { if (err instanceof ApiError) … }`, and a
 * test double that refuses something has to refuse in this shape too.
 * `status` mirrors the HTTP status the server sent; `message` is the plain
 * sentence to show.
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
