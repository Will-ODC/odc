import type { PublishedPublicPoll } from "../voting/public-poll.js";

export interface PublicationActor {
  voterId: string;
  sessionGeneration: number;
}
/**
 * The creation response's poll: the same allow-listed projection that
 * `GET /api/polls/:id` serves (`publicPoll`), with both public authorship
 * fields present.
 */
export type PublicationPoll = PublishedPublicPoll;
export interface PublicationResult {
  poll: PublicationPoll;
  replayed: boolean;
}
export interface CreationContext {
  community: { id: string; label: string };
  canPostUnlimited: boolean;
  purposeVersion: string;
  purposeAcknowledged: boolean;
}
export interface CreationStore {
  context(actor: PublicationActor): Promise<CreationContext>;
  publish(
    actor: PublicationActor,
    key: string,
    body: unknown,
  ): Promise<PublicationResult>;
  setUnlimited(
    actor: PublicationActor,
    target: string,
    enabled: boolean,
  ): Promise<void>;
}
export interface CreationOptions {
  ownerEmail?: string;
  clock?: () => Date;
  newId?: () => string;
}
