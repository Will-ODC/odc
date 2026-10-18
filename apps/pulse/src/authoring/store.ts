import type { PollMethod } from "../voting/poll.js";
import type { Attribution } from "./input.js";

export interface PublicationActor {
  voterId: string;
  sessionGeneration: number;
}
export interface PublicationPoll {
  id: string;
  question: string;
  choices: readonly string[];
  method: PollMethod;
  next: readonly null[];
  acceptsSuggestions: false;
  closesAt: string;
  open: true;
  community: { id: string; label: string };
  attribution: Attribution;
}
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
