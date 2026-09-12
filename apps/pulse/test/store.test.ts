import { InMemoryVotingStore } from "../src/voting/store.js";
import { votingStoreConformance } from "./conformance/voting-store.js";

// The in-memory voting store, held to the suite every implementation runs.
votingStoreConformance(
  "in memory",
  async (clock) => new InMemoryVotingStore(clock),
);
