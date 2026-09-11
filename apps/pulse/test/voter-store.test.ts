import { InMemoryVoterStore } from "../src/identity/store.js";
import { voterStoreConformance } from "./conformance/voter-store.js";

// The in-memory voter store, held to the suite every implementation runs.
voterStoreConformance("in memory", async () => new InMemoryVoterStore());
