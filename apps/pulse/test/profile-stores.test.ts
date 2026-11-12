import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { InMemoryVoterStore, type VoterStore } from "../src/identity/store.js";
import { InMemoryMemberProfileStore } from "../src/profiles/memory-store.js";
import { PostgresMemberProfileStore } from "../src/profiles/pg-store.js";
import type {
  MemberProfileStore,
  ProfileActor,
} from "../src/profiles/store.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

const AT = new Date("2026-11-12T12:00:00.000Z");
const PUBLIC_ID = "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8";
const actor: ProfileActor = {
  voterId: "private-voter-id",
  sessionGeneration: 0,
};

interface Fixture {
  store: MemberProfileStore;
  voters: VoterStore;
  setTime(value: Date): void;
}

for (const kind of ["memory", "postgres"] as const) {
  const skip = kind === "postgres" ? databaseSkip : false;
  const fresh = async (t: TestContext): Promise<Fixture> => {
    let now = AT;
    const pool = kind === "postgres" ? await migratedSchema(t) : undefined;
    const voters = pool
      ? new PostgresVoterStore(pool)
      : new InMemoryVoterStore();
    await voters.create(
      {
        id: actor.voterId,
        community: null,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: "private@example.test", verifiedAt: AT },
    );
    const options = { clock: () => now, newId: () => PUBLIC_ID };
    return {
      store: pool
        ? new PostgresMemberProfileStore(pool, options)
        : new InMemoryMemberProfileStore(voters as InMemoryVoterStore, options),
      voters,
      setTime(value) {
        now = value;
      },
    };
  };

  test(
    `${kind}: profile_is_opt_in_public_and_keeps_its_opaque_id`,
    { skip },
    async (t) => {
      const f = await fresh(t);
      assert.equal(await f.store.byOwner(actor), undefined);
      assert.equal(await f.store.publicById(PUBLIC_ID), undefined);

      const created = await f.store.save(actor, {
        displayName: " Ada ",
        bio: " Neighbour ",
        visible: true,
      });
      assert.equal(created.publicId, PUBLIC_ID);
      assert.deepEqual(await f.store.publicById(PUBLIC_ID), {
        publicId: PUBLIC_ID,
        displayName: "Ada",
        bio: "Neighbour",
        createdAt: AT,
      });
      assert.doesNotMatch(
        JSON.stringify(await f.store.publicById(PUBLIC_ID)),
        /private-voter-id|private@example\.test|visible|updatedAt/,
      );

      const later = new Date(AT.getTime() + 1000);
      f.setTime(later);
      const hidden = await f.store.save(actor, {
        displayName: "Ada Lovelace",
        bio: "",
        visible: false,
      });
      assert.equal(hidden.publicId, PUBLIC_ID);
      assert.equal(hidden.createdAt.getTime(), AT.getTime());
      assert.equal(hidden.updatedAt.getTime(), later.getTime());
      assert.equal(await f.store.publicById(PUBLIC_ID), undefined);
    },
  );

  test(
    `${kind}: only_the_current_owner_session_can_read_or_write`,
    { skip },
    async (t) => {
      const f = await fresh(t);
      const outsider = { voterId: "someone-else", sessionGeneration: 0 };
      await assert.rejects(f.store.byOwner(outsider), {
        message: "signed_out",
      });
      await f.voters.advanceSessionGeneration(actor.voterId);
      await assert.rejects(
        f.store.save(actor, { displayName: "Ada", bio: "", visible: true }),
        { message: "signed_out" },
      );
    },
  );
}
