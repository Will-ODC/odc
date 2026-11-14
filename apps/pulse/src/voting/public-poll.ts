import {
  copyPublicPollImage,
  publicPollImage,
  type PublicPollImage,
} from "../images/public.js";
import {
  isOpen,
  type Attribution,
  type Poll,
  type PollCommunity,
  type PollMethod,
  type Publication,
} from "./poll.js";

/**
 * A poll as anyone may read it: the `GET /api/polls/:id` body, the creation
 * response's `poll`, and so what MCP `get_poll` passes on. Dates are ISO
 * strings and openness is resolved.
 *
 * `community` and `attribution` appear only on a poll published through
 * creation (ADR-0037). On a seed or legacy poll the keys are absent, not null:
 * no author is invented for a poll that never had one.
 */
export interface PublicPoll {
  id: string;
  question: string;
  context: string | null;
  choices: string[];
  method: PollMethod;
  next: (string | null)[];
  acceptsSuggestions: boolean;
  closesAt: string | null;
  open: boolean;
  /** The poster's picture or the tile (ADR-0047); always present. */
  image: PublicPollImage;
  community?: PollCommunity;
  attribution?: Attribution;
}

/** A public poll that was published through creation, so carries both. */
export type PublishedPublicPoll = PublicPoll & Publication;

/**
 * The one allow-listed projection of a poll for public reads. Every field is
 * copied by name — never spread — so anything a store adds to a `Poll` stays
 * private until it is named here. That matters most for authorship: the
 * attribution is rebuilt from its kind, so a named poll carries exactly
 * `{ kind, name }` and an anonymous one exactly `{ kind }`, whatever else the
 * stored value might hold. No author account, email, grant or idempotency
 * data can reach this shape, because none of it is ever read onto a `Poll`
 * and none of it would be copied if it were.
 */
export function publicPoll(
  poll: Poll & { publication: Publication },
  now: Date,
): PublishedPublicPoll;
export function publicPoll(poll: Poll, now: Date): PublicPoll;
export function publicPoll(poll: Poll, now: Date): PublicPoll {
  const body: PublicPoll = {
    id: poll.id,
    question: poll.question,
    context: poll.context ?? null,
    choices: [...poll.choices],
    method: poll.method,
    next: [...poll.next],
    acceptsSuggestions: poll.acceptsSuggestions,
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    open: isOpen(poll, now),
    image: publicPollImage(poll.image),
  };
  if (poll.publication === undefined) return body;
  const { community, attribution } = poll.publication;
  return {
    ...body,
    community: { id: community.id, label: community.label },
    attribution: publicAttribution(attribution),
  };
}

function publicAttribution(attribution: Attribution): Attribution {
  switch (attribution.kind) {
    case "anonymous":
      return { kind: "anonymous" };
    case "named":
      return { kind: "named", name: attribution.name };
    default:
      // Unreachable for a well-typed store; refuse rather than guess, so an
      // unknown kind can never be published as if it were anonymous.
      throw new TypeError("unknown poll attribution");
  }
}

/**
 * A saved creation response, rebuilt field by field for a replay. Snapshots
 * keep their original openness and close time. One saved before poll context
 * existed has no `context` and reads as `null`; one saved before pictures has
 * no `image` and reads as the tile. Every other field, `image` and `context`
 * included, is returned as it was saved.
 */
export function publicPollReplay(
  poll: Omit<PublishedPublicPoll, "context" | "image"> & {
    context?: string | null;
    image?: PublicPollImage;
  },
): PublishedPublicPoll {
  return {
    id: poll.id,
    question: poll.question,
    context: poll.context ?? null,
    choices: [...poll.choices],
    method: poll.method,
    next: [...poll.next],
    acceptsSuggestions: poll.acceptsSuggestions,
    closesAt: poll.closesAt,
    open: poll.open,
    image: copyPublicPollImage(poll.image),
    community: { id: poll.community.id, label: poll.community.label },
    attribution: publicAttribution(poll.attribution),
  };
}
