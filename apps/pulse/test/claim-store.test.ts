import { InMemoryClaimStore } from "../src/identity/store.js";
import { claimStoreConformance } from "./conformance/claim-store.js";

// The in-memory claim store, held to the suite every implementation runs.
claimStoreConformance("in memory", async () => new InMemoryClaimStore());
