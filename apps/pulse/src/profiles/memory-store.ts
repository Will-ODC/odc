import { randomUUID } from "node:crypto";
import { InMemoryVoterStore } from "../identity/store.js";
import { normalizeProfile, type ProfileInput } from "./input.js";
import {
  ProfileStoreError,
  type MemberProfile,
  type MemberProfileStore,
  type ProfileActor,
  type ProfileStoreOptions,
  type PublicMemberProfile,
  type VisibleProfileOwner,
} from "./store.js";

interface State {
  profiles: Map<string, MemberProfile>;
}
const databases = new WeakMap<InMemoryVoterStore, State>();

export class InMemoryMemberProfileStore implements MemberProfileStore {
  readonly #voters: InMemoryVoterStore;
  readonly #state: State;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(voters: InMemoryVoterStore, options: ProfileStoreOptions = {}) {
    this.#voters = voters;
    this.#state = databases.get(voters) ?? { profiles: new Map() };
    databases.set(voters, this.#state);
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async publicById(publicId: string): Promise<PublicMemberProfile | undefined> {
    return (await this.visibleOwnerById(publicId))?.profile;
  }

  async visibleOwnerById(
    publicId: string,
  ): Promise<VisibleProfileOwner | undefined> {
    const found = [...this.#state.profiles.entries()].find(
      ([, candidate]) => candidate.publicId === publicId,
    );
    if (!found?.[1].visible) return undefined;
    return { voterId: found[0], profile: publicProfile(found[1]) };
  }

  async publicByOwnerId(
    voterId: string,
  ): Promise<PublicMemberProfile | undefined> {
    const profile = this.#state.profiles.get(voterId);
    return profile?.visible ? publicProfile(profile) : undefined;
  }

  byOwner(actor: ProfileActor): Promise<MemberProfile | undefined> {
    return this.#voters.exclusive(async () => {
      await this.#verify(actor);
      return clone(this.#state.profiles.get(actor.voterId));
    });
  }

  save(actor: ProfileActor, input: ProfileInput): Promise<MemberProfile> {
    const normalized = normalizeProfile(input);
    return this.#voters.exclusive(async () => {
      await this.#verify(actor);
      const current = this.#state.profiles.get(actor.voterId);
      const now = this.#clock();
      if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
      const profile: MemberProfile = {
        publicId: current?.publicId ?? this.#newId(),
        displayName: normalized.displayName,
        bio: normalized.bio,
        visible: normalized.visible,
        createdAt: current?.createdAt ?? now,
        // A clock that has stepped back (another instance, an NTP step)
        // never makes the update time earlier than the creation time.
        updatedAt: current && current.createdAt > now ? current.createdAt : now,
      };
      this.#state.profiles.set(actor.voterId, profile);
      return clone(profile) as MemberProfile;
    });
  }

  async #verify(actor: ProfileActor): Promise<void> {
    const voter = await this.#voters.byId(actor.voterId);
    if (
      !voter ||
      !Number.isSafeInteger(actor.sessionGeneration) ||
      actor.sessionGeneration < 0 ||
      (voter.sessionGeneration ?? 0) !== actor.sessionGeneration
    )
      throw new ProfileStoreError("signed_out");
  }
}

function clone(profile: MemberProfile | undefined): MemberProfile | undefined {
  return profile
    ? {
        ...profile,
        createdAt: new Date(profile.createdAt),
        updatedAt: new Date(profile.updatedAt),
      }
    : undefined;
}

function publicProfile(profile: MemberProfile): PublicMemberProfile {
  return {
    publicId: profile.publicId,
    displayName: profile.displayName,
    bio: profile.bio,
    createdAt: new Date(profile.createdAt),
  };
}
