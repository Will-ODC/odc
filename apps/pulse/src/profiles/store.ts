import type { ProfileInput } from "./input.js";

export interface ProfileActor {
  voterId: string;
  sessionGeneration: number;
}

export interface MemberProfile {
  publicId: string;
  displayName: string;
  bio: string;
  visible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicMemberProfile {
  publicId: string;
  displayName: string;
  bio: string;
  createdAt: Date;
}

/**
 * Internal lookup result. The voter id must never be copied into an HTTP
 * response.
 */
export interface VisibleProfileOwner {
  voterId: string;
  profile: PublicMemberProfile;
}

export class ProfileStoreError extends Error {
  constructor(readonly code: "signed_out") {
    super(code);
    this.name = "ProfileStoreError";
  }
}

export interface MemberProfileStore {
  publicById(publicId: string): Promise<PublicMemberProfile | undefined>;
  visibleOwnerById(publicId: string): Promise<VisibleProfileOwner | undefined>;
  publicByOwnerId(voterId: string): Promise<PublicMemberProfile | undefined>;
  byOwner(actor: ProfileActor): Promise<MemberProfile | undefined>;
  save(actor: ProfileActor, input: ProfileInput): Promise<MemberProfile>;
}

export interface ProfileStoreOptions {
  clock?: () => Date;
  newId?: () => string;
}
