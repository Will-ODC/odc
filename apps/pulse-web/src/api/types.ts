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

export interface Me {
  voterId: string;
  community: string;
  /** The address the link was sent to, shown back so a typo is obvious. */
  email: string;
}

export interface PulseApi {
  /** Ask for a sign-in link. Resolves once sent; never says whether the address exists. */
  requestLink(email: string, wantsUpdates: boolean): Promise<RequestLinkResult>;
  /** Redeem the token from the emailed link. */
  redeem(token: string): Promise<Me>;
  me(): Promise<Me | null>;
  poll(pollId: string): Promise<Poll>;
  myBallot(pollId: string): Promise<Ballot | null>;
  results(pollId: string): Promise<Results>;
  cast(pollId: string, ballot: Ballot): Promise<CastOutcome>;
}

export type RequestLinkResult =
  | { status: "sent" }
  /** Dev only: no mail is sent, so the link comes straight back. */
  | { status: "sent"; devLink: string }
  | { status: "not_eligible"; message: string };
