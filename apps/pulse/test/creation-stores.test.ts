import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import type { CreationOptions } from "../src/authoring/store.js";
import { InMemoryVoterStore } from "../src/identity/store.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { AT, creationConformance } from "./conformance/creation-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

for (const kind of ["memory", "postgres"] as const)
  creationConformance(
    kind,
    async (t) => {
      let now = AT;
      const clock = () => now;
      const pool = kind === "postgres" ? await migratedSchema(t) : undefined;
      if (pool)
        await pool.query("insert into community values ('campus', 'Campus')");
      const voters = pool
        ? new PostgresVoterStore(pool)
        : new InMemoryVoterStore();
      const voting = pool
        ? new PostgresVotingStore(pool, clock)
        : new InMemoryVotingStore(clock);
      for (const [id, community] of [
        ["owner-account", null],
        ["member-private", "campus"],
        ["guest-account", null],
      ] as const)
        await voters.create(
          {
            id,
            community,
            assurance: "email",
            claimedAt: AT,
            proofEmailsOptIn: false,
          },
          { kind: "email", value: `${id}@example.test`, verifiedAt: AT },
        );
      const make = (override: CreationOptions = {}) => {
        const options = {
          ownerEmail: "OWNER-ACCOUNT@example.test",
          clock,
          ...override,
        };
        return pool
          ? new PostgresCreationStore(pool, options)
          : new InMemoryCreationStore(
              voters as InMemoryVoterStore,
              voting as InMemoryVotingStore,
              { ...options, communityLabels: new Map([["campus", "Campus"]]) },
            );
      };
      return {
        store: make(),
        other: make(),
        make,
        voters,
        voting,
        setTime: (time) => {
          now = time;
        },
      };
    },
    kind === "postgres" ? databaseSkip : false,
  );
