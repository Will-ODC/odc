import { createHash, randomUUID } from "node:crypto";
import { pictureInput, type PictureInput } from "../images/input.js";
import {
  publicImage,
  type ItemImage,
  type PublicImage,
} from "../images/public.js";
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
export interface ContributionRecord extends Omit<ContributionInput, "image"> {
  id: string;
  community: { id: string; label: string };
  status: ContributionStatus;
  createdAt: string;
  participations: (ParticipationInput & { id: string; createdAt: string })[];
  updates: (UpdateInput & { id: string; createdAt: string })[];
}
export interface Contribution extends ContributionRecord {
  image: PublicImage;
}
export type Summary = Omit<Contribution, "participations" | "updates">;
/**
 * How many participations, and separately how many private messages, one
 * account may add to one contribution. The 500-entry record caps are shared,
 * so without this one account could fill a record for everyone.
 */
export const SENDER_LIMIT = 20;
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
  public: ContributionRecord;
  image?: ItemImage;
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
export type ContributionPictureChange =
  | { action: "image_attach" | "image_replace"; input: PictureInput }
  | { action: "image_remove" };

export interface ContributionTransaction {
  community: { id: string; label: string };
  replay(key: string): Promise<Replay | undefined>;
  recent(since: string): Promise<number>;
  visiblePoll(id: string): Promise<boolean>;
  /** Participations this actor has already added to one contribution. */
  senderEntries(kind: "participate", contributionId: string): Promise<number>;
  get(id: string): Promise<StoredContribution | undefined>;
  save(record: StoredContribution, isNew: boolean): Promise<void>;
  setPicture(
    id: string,
    now: Date,
    change: ContributionPictureChange,
  ): Promise<ItemImage | undefined>;
  remember(key: string, replay: Replay): Promise<void>;
}
export interface ContributionRepository {
  read(id: string): Promise<StoredContribution | undefined>;
  list(query: ListQuery, ownerId?: string): Promise<Summary[]>;
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
    return this.page(await this.repository.list(query));
  }
  async listByOwner(ownerId: string, query: ListQuery) {
    return this.page(await this.repository.list(query, ownerId));
  }
  private page(rows: Summary[]) {
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
  /**
   * One read. `ownerId` is for server-side lookups only (the organizer
   * profile); callers must never put it in a response.
   */
  async detailWithOwner(id: string, actorId?: string) {
    const record = await this.repository.read(id);
    if (!record) throw new ContributionError("not_found");
    return {
      contribution: project(record),
      canManage: record.ownerId === actorId,
      ownerId: record.ownerId,
    };
  }
  async detail(id: string, actorId?: string) {
    const { contribution, canManage } = await this.detailWithOwner(id, actorId);
    return { contribution, canManage };
  }
  async create(
    actor: PublicationActor,
    key: string,
    raw: unknown,
  ): Promise<MutationResult> {
    const input = parse(creationSchema, raw);
    const { image, ...fields } = input;
    // Retry comparison survives removal without retaining the picture description.
    const imageFingerprint =
      image &&
      createHash("sha256")
        .update(JSON.stringify([image.id, image.alt]))
        .digest("hex");
    const replayInput = imageFingerprint
      ? { ...fields, imageFingerprint }
      : fields;
    return this.mutate(actor, key, ["create", replayInput], async (tx) => {
      const now = this.clock();
      if (
        (await tx.recent(new Date(now.getTime() - 3_600_000).toISOString())) >=
        5
      )
        throw new ContributionError("posting_limit");
      if (input.pollId && !(await tx.visiblePoll(input.pollId)))
        throw new ContributionError("poll_not_found");
      const contribution: ContributionRecord = {
        ...fields,
        id: randomUUID(),
        community: tx.community,
        status: "open",
        createdAt: now.toISOString(),
        participations: [],
        updates: [],
      };
      await tx.save({ ownerId: actor.voterId, public: contribution }, true);
      const attached =
        image &&
        (await tx.setPicture(contribution.id, now, {
          action: "image_attach",
          input: image,
        }));
      return { ...contribution, image: publicImage(attached) };
    });
  }
  removePicture(actor: PublicationActor, id: string, expectedImageId?: string) {
    return this.changePicture(
      actor,
      id,
      { action: "image_remove" },
      expectedImageId,
    );
  }
  async replacePicture(actor: PublicationActor, id: string, raw: unknown) {
    return this.changePicture(actor, id, {
      action: "image_replace",
      input: parse(pictureInput, raw),
    });
  }
  private changePicture(
    actor: PublicationActor,
    id: string,
    change: ContributionPictureChange,
    expectedImageId?: string,
  ) {
    return this.repository.transaction(actor, async (tx) => {
      const record = await this.required(tx, id);
      if (record.ownerId !== actor.voterId)
        throw new ContributionError("organizer_required");
      if (expectedImageId !== undefined && expectedImageId !== record.image?.id)
        throw new ContributionError("image_changed");
      return {
        image: publicImage(await tx.setPicture(id, this.clock(), change)),
      };
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
      if ((await tx.senderEntries("participate", id)) >= SENDER_LIMIT)
        throw new ContributionError("sender_limit");
      record.public.participations.push({
        ...input,
        id: randomUUID(),
        createdAt: this.clock().toISOString(),
      });
      await tx.save(record, false);
      return project(record);
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
      return project(record);
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
      if (
        messages.filter((entry) => entry.senderId === actor.voterId).length >=
        SENDER_LIMIT
      )
        throw new ContributionError("sender_limit");
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
            ...project(record),
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
function project(record: StoredContribution): Contribution {
  return { ...record.public, image: publicImage(record.image) };
}
export function summary(record: StoredContribution): Summary {
  const { public: fields, image } = record;
  return {
    id: fields.id,
    title: fields.title,
    description: fields.description,
    communityBenefit: fields.communityBenefit,
    needs: fields.needs,
    kind: fields.kind,
    organizerName: fields.organizerName,
    community: fields.community,
    pollId: fields.pollId,
    commercial: fields.commercial,
    fund: fields.fund,
    status: fields.status,
    createdAt: fields.createdAt,
    image: publicImage(image),
  };
}
