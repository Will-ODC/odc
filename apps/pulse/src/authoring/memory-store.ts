import { randomUUID } from "node:crypto";
import { parseEmail } from "../identity/email.js";
import { InMemoryVoterStore, type Voter } from "../identity/store.js";
import { InMemoryVotingStore } from "../voting/store.js";
import { createPoll } from "../voting/poll.js";
import {
  CreationError,
  HOUR_MS,
  PURPOSE_VERSION,
  WEEK_MS,
  normalizeCreation,
  requestKey,
} from "./input.js";
import type {
  CreationContext,
  CreationOptions,
  CreationStore,
  PublicationActor,
  PublicationPoll,
  PublicationResult,
} from "./store.js";

interface MemoryDatabase {
  voters: InMemoryVoterStore;
  acknowledgements: Set<string>;
  publications: Map<string, { authorId: string; createdAt: number }>;
  replays: Map<string, { canonical: string; poll: PublicationPoll }>;
  grants: Map<string, boolean>;
  grantChanges: {
    id: string;
    voterId: string;
    enabled: boolean;
    changedBy: string;
    changedAt: Date;
  }[];
}
// One voting store is one ephemeral database. Separate adapters over it share state.
const databases = new WeakMap<InMemoryVotingStore, MemoryDatabase>();

/** Same-process reference only; deployed instances must use Postgres. */
export class InMemoryCreationStore implements CreationStore {
  readonly #state: MemoryDatabase;
  readonly #voting: InMemoryVotingStore;
  readonly #ownerEmail: string | null;
  readonly #clock: () => Date;
  readonly #newId: () => string;
  readonly #labels: ReadonlyMap<string, string>;

  constructor(
    voters: InMemoryVoterStore,
    voting: InMemoryVotingStore,
    options: CreationOptions & {
      communityLabels?: ReadonlyMap<string, string>;
    } = {},
  ) {
    try {
      this.#ownerEmail =
        options.ownerEmail === undefined
          ? null
          : parseEmail(options.ownerEmail).value;
    } catch {
      throw new Error("PULSE_OWNER_EMAIL is not a usable address");
    }
    const existing = databases.get(voting);
    if (existing && existing.voters !== voters)
      throw new Error(
        "memory voting and identity stores must belong to the same database",
      );
    this.#state = existing ?? {
      voters,
      acknowledgements: new Set(),
      publications: new Map(),
      replays: new Map(),
      grants: new Map(),
      grantChanges: [],
    };
    databases.set(voting, this.#state);
    this.#voting = voting;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
    this.#labels = new Map(options.communityLabels);
  }

  context(actor: PublicationActor): Promise<CreationContext> {
    return this.#state.voters.exclusive(async () => {
      const account = await this.#account(actor);
      return {
        community: this.#community(account),
        canPostUnlimited: await this.#unlimited(account.id),
        purposeVersion: PURPOSE_VERSION,
        purposeAcknowledged: this.#state.acknowledgements.has(account.id),
      };
    });
  }

  async publish(
    actor: PublicationActor,
    key: string,
    body: unknown,
  ): Promise<PublicationResult> {
    const input = normalizeCreation(body);
    key = requestKey(key);
    return this.#state.voters.exclusive(async () => {
      const account = await this.#account(actor);
      const replayKey = JSON.stringify([account.id, key]);
      const canonical = JSON.stringify(input);
      const replay = this.#state.replays.get(replayKey);
      if (replay) {
        if (canonical !== replay.canonical)
          throw new CreationError("idempotency_conflict");
        return { poll: structuredClone(replay.poll), replayed: true };
      }
      const now = this.#clock();
      const closesAt =
        input.closesAt === null
          ? new Date(now.getTime() + WEEK_MS)
          : new Date(input.closesAt);
      if (
        !Number.isFinite(now.getTime()) ||
        !Number.isFinite(closesAt.getTime()) ||
        closesAt <= now
      )
        throw new CreationError("bad_request");
      if (
        !this.#state.acknowledgements.has(account.id) &&
        input.purposeAcknowledgement !== PURPOSE_VERSION
      )
        throw new CreationError("purpose_required");
      const recent = [...this.#state.publications.values()]
        .filter((post) => post.authorId === account.id)
        .map((post) => post.createdAt)
        .filter((time) => time > now.getTime() - HOUR_MS)
        .sort((a, b) => a - b);
      if (!(await this.#unlimited(account.id)) && recent.length >= 5) {
        const nextSlot = recent[recent.length - 5] ?? now.getTime();
        throw new CreationError(
          "posting_limit",
          Math.max(1, Math.ceil((nextSlot + HOUR_MS - now.getTime()) / 1000)),
        );
      }
      const poll = createPoll(
        {
          id: this.#newId(),
          question: input.question,
          choices: input.choices,
          method: input.method,
          closesAt,
        },
        now,
      );
      const publicPoll: PublicationPoll = {
        id: poll.id,
        question: poll.question,
        choices: [...poll.choices],
        method: poll.method,
        next: poll.choices.map(() => null),
        acceptsSuggestions: false,
        closesAt: closesAt.toISOString(),
        open: true,
        community: this.#community(account),
        attribution: input.attribution,
      };
      // The only fallible write precedes all authoring state changes. It either
      // inserts the validated poll or rejects without inserting. No ballot is read.
      await this.#voting.createPoll(poll);
      this.#state.publications.set(poll.id, {
        authorId: account.id,
        createdAt: now.getTime(),
      });
      this.#state.acknowledgements.add(account.id);
      this.#state.replays.set(replayKey, { canonical, poll: publicPoll });
      return { poll: structuredClone(publicPoll), replayed: false };
    });
  }

  async setUnlimited(
    actor: PublicationActor,
    target: string,
    enabled: boolean,
  ): Promise<void> {
    if (typeof enabled !== "boolean") throw new CreationError("bad_request");
    await this.#state.voters.exclusive(async () => {
      const account = await this.#account(actor);
      if (!(await this.#owner(account.id)))
        throw new CreationError("owner_required");
      if (!(await this.#state.voters.byId(target)))
        throw new CreationError("not_found");
      if ((this.#state.grants.get(target) ?? false) === enabled) return;
      // Construct the audit record before either write so ID/clock failure is atomic.
      const change = {
        id: this.#newId(),
        voterId: target,
        enabled,
        changedBy: account.id,
        changedAt: this.#clock(),
      };
      if (
        !Number.isFinite(change.changedAt.getTime()) ||
        this.#state.grantChanges.some((row) => row.id === change.id)
      )
        throw new Error("posting permission audit cannot be recorded");
      this.#state.grants.set(target, enabled);
      this.#state.grantChanges.push(change);
    });
  }

  async #account(actor: PublicationActor): Promise<Voter> {
    const row = await this.#state.voters.byId(actor.voterId);
    if (
      !row ||
      !Number.isSafeInteger(actor.sessionGeneration) ||
      actor.sessionGeneration < 0 ||
      !Number.isSafeInteger(row.sessionGeneration ?? 0) ||
      (row.sessionGeneration ?? 0) !== actor.sessionGeneration
    )
      throw new CreationError("signed_out");
    return row;
  }
  async #owner(id: string): Promise<boolean> {
    return (
      this.#ownerEmail !== null &&
      (await this.#state.voters.byCredential("email", this.#ownerEmail))?.id ===
        id
    );
  }
  async #unlimited(id: string): Promise<boolean> {
    return (await this.#owner(id)) || this.#state.grants.get(id) === true;
  }
  #community(account: Voter): { id: string; label: string } {
    if (account.community === "pulse-general")
      throw new Error("General is a posting destination, not membership");
    const id = account.community ?? "pulse-general";
    return {
      id,
      label: id === "pulse-general" ? "General" : (this.#labels.get(id) ?? id),
    };
  }
}
