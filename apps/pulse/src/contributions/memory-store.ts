import type { PublicationActor } from "../authoring/store.js";
import type { InMemoryVoterStore } from "../identity/store.js";
import type { VotingStore } from "../voting/store.js";
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
  constructor(
    private readonly voters: InMemoryVoterStore,
    private readonly votes: VotingStore,
    private readonly labels: ReadonlyMap<string, string>,
  ) {}
  async read(id: string) {
    return structuredClone(this.records.get(id));
  }
  async list(query: ListQuery, ownerId?: string) {
    return [...this.records.values()]
      .filter((record) => ownerId === undefined || record.ownerId === ownerId)
      .map((r) => summary(r.public))
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
        get: async (id) => structuredClone(records.get(id)),
        save: async (record) => {
          records.set(record.public.id, structuredClone(record));
        },
        remember: async (key, replay) => {
          replays.set(replayKey(key), structuredClone(replay));
        },
      });
      this.records = records;
      this.replays = replays;
      return structuredClone(result);
    });
  }
}
export class InMemoryContributionsStore extends ContributionsStore {
  constructor(
    voters: InMemoryVoterStore,
    votes: VotingStore,
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
