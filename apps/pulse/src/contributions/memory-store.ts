import { randomUUID } from "node:crypto";
import type { PublicationActor } from "../authoring/store.js";
import type { InMemoryVoterStore } from "../identity/store.js";
import type { InMemoryVotingStore } from "../voting/store.js";
import {
  attachablePending,
  attachInMemory,
  contributionImageInMemory,
  memoryImageDatabase,
  recordPictureChange,
  type MemoryImageDatabase,
  type PictureChange,
} from "../images/store.js";
import { ContributionError, type ListQuery } from "./input.js";
import {
  ContributionsStore,
  summary,
  type ContributionRepository,
  type ContributionTransaction,
  type Replay,
  type StoredContribution,
} from "./store.js";
class MemoryRepository implements ContributionRepository {
  private records = new Map<string, StoredContribution>();
  private replays = new Map<string, Replay>();
  private readonly pictures: MemoryImageDatabase;
  constructor(
    private readonly voters: InMemoryVoterStore,
    private readonly votes: InMemoryVotingStore,
    private readonly labels: ReadonlyMap<string, string>,
  ) {
    this.pictures = memoryImageDatabase(votes);
  }
  async read(id: string) {
    return this.withPicture(this.records.get(id));
  }
  private withPicture(record: StoredContribution | undefined) {
    if (!record) return undefined;
    const image = contributionImageInMemory(this.pictures, record.public.id);
    return { ...structuredClone(record), ...(image ? { image } : {}) };
  }
  async list(query: ListQuery, ownerId?: string) {
    return [...this.records.values()]
      .filter((record) => ownerId === undefined || record.ownerId === ownerId)
      .map((record) => {
        const image = contributionImageInMemory(
          this.pictures,
          record.public.id,
        );
        return summary({ ...record, ...(image ? { image } : {}) });
      })
      .filter(
        (r) =>
          !query.before ||
          r.createdAt < query.before.createdAt ||
          (r.createdAt === query.before.createdAt && r.id < query.before.id),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .slice(0, 21)
      .map((r) => structuredClone(r));
  }
  transaction<T>(
    actor: PublicationActor,
    work: (tx: ContributionTransaction) => Promise<T>,
  ): Promise<T> {
    return this.voters.exclusive(async () => {
      const account = await this.voters.byId(actor.voterId);
      if (
        !account ||
        !Number.isSafeInteger(actor.sessionGeneration) ||
        actor.sessionGeneration < 0 ||
        (account.sessionGeneration ?? 0) !== actor.sessionGeneration
      )
        throw new ContributionError("signed_out");
      const records = new Map(this.records);
      const replays = new Map(this.replays);
      const replayKey = (key: string) => JSON.stringify([actor.voterId, key]);
      const communityId = account.community ?? "pulse-general";
      let commitPicture: (() => void) | undefined;
      const result = await work({
        community: {
          id: communityId,
          label:
            communityId === "pulse-general"
              ? "General"
              : (this.labels.get(communityId) ?? communityId),
        },
        replay: async (key) => structuredClone(replays.get(replayKey(key))),
        recent: async (since) =>
          [...records.values()].filter(
            (r) => r.ownerId === actor.voterId && r.public.createdAt > since,
          ).length,
        visiblePoll: async (id) => !!(await this.votes.getPoll(id)),
        senderEntries: async (kind, contributionId) =>
          [...replays.entries()].filter(([encodedActor, replay]) => {
            const [voterId] = JSON.parse(encodedActor) as [string, string];
            if (
              voterId !== actor.voterId ||
              replay.contributionId !== contributionId
            )
              return false;
            const canonical = JSON.parse(replay.canonical) as unknown[];
            return canonical[0] === kind;
          }).length,
        get: async (id) => this.withPicture(records.get(id)),
        save: async (record) => {
          records.set(
            record.public.id,
            structuredClone({
              ownerId: record.ownerId,
              public: record.public,
              ...(record.privateMessages
                ? { privateMessages: record.privateMessages }
                : {}),
            }),
          );
        },
        setPicture: async (id, now, operation) => {
          const db = this.pictures;
          const oldId = db.contributionImages.get(id);
          const change: PictureChange = {
            action: operation.action,
            targetKind: "contribution",
            targetId: id,
            actorId: actor.voterId,
            changeId: randomUUID(),
            now,
          };
          if (operation.action === "image_remove") {
            if (oldId === undefined) return undefined;
            const old = db.images.get(oldId);
            if (!old) throw new Error("current contribution picture missing");
            commitPicture = () => {
              recordPictureChange(db, old, change);
              db.contributionImages.delete(id);
              db.images.delete(oldId);
            };
            return undefined;
          }

          const { id: pendingId, alt } = operation.input;
          const pending = attachablePending(db, pendingId, actor.voterId, now);
          if (!pending) throw new ContributionError("image_unavailable");
          commitPicture = () => {
            attachInMemory(db, pending, alt, change);
            db.contributionImages.set(id, pending.id);
            if (oldId !== undefined) db.images.delete(oldId);
          };
          return {
            id: pending.id,
            width: pending.width,
            height: pending.height,
            alt,
          };
        },
        remember: async (key, replay) => {
          replays.set(replayKey(key), structuredClone(replay));
        },
      });
      commitPicture?.();
      this.records = records;
      this.replays = replays;
      return structuredClone(result);
    });
  }
}
export class InMemoryContributionsStore extends ContributionsStore {
  constructor(
    voters: InMemoryVoterStore,
    votes: InMemoryVotingStore,
    options: {
      clock?: () => Date;
      communityLabels?: ReadonlyMap<string, string>;
    } = {},
  ) {
    super(
      new MemoryRepository(voters, votes, new Map(options.communityLabels)),
      options.clock,
    );
  }
}
