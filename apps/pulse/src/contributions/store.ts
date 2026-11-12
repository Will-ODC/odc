import { randomUUID } from "node:crypto";
import type { PublicationActor } from "../authoring/store.js";
import {
  ContributionError,
  creationSchema,
  participationSchema,
  messageSchema,
  updateSchema,
  parse,
  requestKey,
  type ContributionInput,
  type ContributionStatus,
  type ParticipationInput,
  type UpdateInput,
  type ListQuery,
} from "./input.js";
export interface Contribution extends ContributionInput {
  id: string;
  community: { id: string; label: string };
  status: ContributionStatus;
  createdAt: string;
  participations: (ParticipationInput & { id: string; createdAt: string })[];
  updates: (UpdateInput & { id: string; createdAt: string })[];
}
export type Summary = Omit<Contribution, "participations" | "updates">;
interface OrganizerMessage {
  id: string;
  message: string;
  createdAt: string;
}
interface StoredMessage extends OrganizerMessage {
  senderId: string;
  key: string;
}
export interface StoredContribution {
  ownerId: string;
  public: Contribution;
  privateMessages?: StoredMessage[];
}
export interface MutationResult {
  contribution: Contribution;
  replayed: boolean;
}
export interface Replay {
  canonical: string;
  contributionId: string;
  participationCount: number;
  updateCount: number;
}
export interface ContributionTransaction {
  community: { id: string; label: string };
  replay(key: string): Promise<Replay | undefined>;
  recent(since: string): Promise<number>;
  visiblePoll(id: string): Promise<boolean>;
  get(id: string): Promise<StoredContribution | undefined>;
  save(record: StoredContribution, isNew: boolean): Promise<void>;
  remember(key: string, replay: Replay): Promise<void>;
}
export interface ContributionRepository {
  read(id: string): Promise<StoredContribution | undefined>;
  list(query: ListQuery): Promise<Summary[]>;
  transaction<T>(
    actor: PublicationActor,
    work: (tx: ContributionTransaction) => Promise<T>,
  ): Promise<T>;
}
export class ContributionsStore {
  constructor(
    private readonly repository: ContributionRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async list(query: ListQuery) {
    const rows = await this.repository.list(query);
    const contributions = rows.slice(0, 20);
    const last = contributions.at(-1);
    return {
      contributions,
      nextCursor:
        rows.length > 20 && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.createdAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async detail(id: string, actorId?: string) {
    const record = await this.repository.read(id);
    if (!record) throw new ContributionError("not_found");
    return {
      contribution: record.public,
      canManage: record.ownerId === actorId,
    };
  }
  async create(
    actor: PublicationActor,
    key: string,
    raw: unknown,
  ): Promise<MutationResult> {
    const input = parse(creationSchema, raw);
    return this.mutate(actor, key, ["create", input], async (tx) => {
      const now = this.clock();
      if (
        (await tx.recent(new Date(now.getTime() - 3_600_000).toISOString())) >=
        5
      )
        throw new ContributionError("posting_limit");
      if (input.pollId && !(await tx.visiblePoll(input.pollId)))
        throw new ContributionError("poll_not_found");
      const contribution: Contribution = {
        ...input,
        id: randomUUID(),
        community: tx.community,
        status: "open",
        createdAt: now.toISOString(),
        participations: [],
        updates: [],
      };
      await tx.save({ ownerId: actor.voterId, public: contribution }, true);
      return contribution;
    });
  }
  async participate(
    actor: PublicationActor,
    id: string,
    key: string,
    raw: unknown,
  ): Promise<MutationResult> {
    const input = parse(participationSchema, raw);
    return this.mutate(actor, key, ["participate", id, input], async (tx) => {
      const record = await this.required(tx, id);
      if (
        ["completed", "cancelled"].includes(record.public.status) &&
        input.kind !== "report"
      )
        throw new ContributionError("closed");
      if (record.public.participations.length >= 500)
        throw new ContributionError("record_full");
      record.public.participations.push({
        ...input,
        id: randomUUID(),
        createdAt: this.clock().toISOString(),
      });
      await tx.save(record, false);
      return record.public;
    });
  }
  async update(
    actor: PublicationActor,
    id: string,
    key: string,
    raw: unknown,
  ): Promise<MutationResult> {
    const input = parse(updateSchema, raw);
    return this.mutate(actor, key, ["update", id, input], async (tx) => {
      const record = await this.required(tx, id);
      if (record.ownerId !== actor.voterId)
        throw new ContributionError("organizer_required");
      if (record.public.updates.length >= 500)
        throw new ContributionError("record_full");
      record.public.updates.push({
        ...input,
        id: randomUUID(),
        createdAt: this.clock().toISOString(),
      });
      record.public.status = input.status;
      await tx.save(record, false);
      return record.public;
    });
  }
  async messages(actor: PublicationActor, id: string) {
    return this.repository.transaction(actor, async (tx) => {
      const record = await this.required(tx, id);
      if (record.ownerId !== actor.voterId)
        throw new ContributionError("organizer_required");
      return {
        messages: (record.privateMessages ?? []).map(
          ({ id, message, createdAt }) => ({
            id,
            message,
            createdAt,
          }),
        ),
      };
    });
  }

  async sendMessage(
    actor: PublicationActor,
    id: string,
    key: string,
    raw: unknown,
  ) {
    const { message } = parse(messageSchema, raw);
    key = requestKey(key);
    return this.repository.transaction(actor, async (tx) => {
      const record = await this.required(tx, id);
      const messages = record.privateMessages ?? [];
      const existing = messages.find(
        (entry) => entry.senderId === actor.voterId && entry.key === key,
      );
      if (existing) {
        if (existing.message !== message)
          throw new ContributionError("idempotency_conflict");
        return { id: existing.id, replayed: true };
      }
      if (messages.length >= 500) throw new ContributionError("record_full");
      const messageId = randomUUID();
      messages.push({
        id: messageId,
        message,
        createdAt: this.clock().toISOString(),
        senderId: actor.voterId,
        key,
      });
      record.privateMessages = messages;
      await tx.save(record, false);
      return { id: messageId, replayed: false };
    });
  }

  private async required(tx: ContributionTransaction, id: string) {
    const record = await tx.get(id);
    if (!record) throw new ContributionError("not_found");
    return record;
  }
  private mutate(
    actor: PublicationActor,
    key: string,
    input: unknown,
    work: (tx: ContributionTransaction) => Promise<Contribution>,
  ): Promise<MutationResult> {
    key = requestKey(key);
    const canonical = JSON.stringify(input);
    return this.repository.transaction(actor, async (tx) => {
      const replay = await tx.replay(key);
      if (replay) {
        if (replay.canonical !== canonical)
          throw new ContributionError("idempotency_conflict");
        const record = await this.required(tx, replay.contributionId);
        const participations = record.public.participations.slice(
          0,
          replay.participationCount,
        );
        const updates = record.public.updates.slice(0, replay.updateCount);
        return {
          contribution: {
            ...record.public,
            status: updates.at(-1)?.status ?? "open",
            participations,
            updates,
          },
          replayed: true,
        };
      }
      const contribution = await work(tx);
      await tx.remember(key, {
        canonical,
        contributionId: contribution.id,
        participationCount: contribution.participations.length,
        updateCount: contribution.updates.length,
      });
      return { contribution, replayed: false };
    });
  }
}
export function summary(record: Contribution): Summary {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    communityBenefit: record.communityBenefit,
    needs: record.needs,
    kind: record.kind,
    organizerName: record.organizerName,
    community: record.community,
    pollId: record.pollId,
    commercial: record.commercial,
    fund: record.fund,
    status: record.status,
    createdAt: record.createdAt,
  };
}
