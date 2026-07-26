// The vector table, assembled from one module per category.
//
// Split by category rather than kept as one list so each group can be reviewed
// against the spec section it encodes, and so no single file outgrows a
// reviewable diff. Order here is the order in index.json and in the vector ids.

import { validVectors } from "./valid.js";
import type { Vector } from "./shared.js";

export { GENESIS_EVENT } from "./shared.js";
export type { Expect, Vector } from "./shared.js";

export const vectors: Vector[] = [...validVectors];
