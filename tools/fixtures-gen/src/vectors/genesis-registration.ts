// The one type that must be registered: `genesis` (evolution.md EV-20, EV-9).
//
// This is T9 audit finding F3, decided in ADR-0015 and specified as EV-20: a
// chain whose FIRST line carries a `(type, version)` the verifier does not
// register is INVALID at line 1, and the verifier MUST NOT walk on to a
// chain-level VALID or PARTIAL. It is the single exception to EV-8, and a Stage
// A promotion for `genesis` alone — EV-15 assigns ES-9/ES-11 registration to
// Stage B everywhere else, and carves out line 1 by name.
//
// Why the exception exists, in one sentence: `genesis` is the only event whose
// PAYLOAD a verifier must read to check any OTHER event, because operator_pk and
// registrar_pk live there (ET-9a). An unregistered genesis leaves those keys
// unextractable, so every later signature is uncheckable — and PARTIAL, which
// means "integrity confirmed, some semantics unchecked", would announce success
// over a chain on which NOTHING was ever authenticated.
//
// This vector could not be written until now, and the reason is recorded rather
// than forgotten. `conformance.test.ts` carried a guard asserting that no vector
// anywhere carries a genesis at a version other than 1, precisely so that no
// fixture could freeze a verdict here while EV-9 still said the opposite in
// its own PARTIAL sentence. That contradiction is closed (evolution.md v5), so
// the guard is INVERTED rather than deleted — it now requires that this vector,
// by id, is the only one that may do it. Deleting it would let a future PARTIAL
// vector freeze a verdict EV-20 forbids; relaxing it to "any reserved version"
// would do the same thing more quietly.

import { bad, headless, lines, type Vector } from "./shared.js";
import { RESERVED_VERSION } from "./unregistered.js";
import { OPERATOR, REGISTRAR } from "../chain.js";
import { chainId } from "../encode.js";

/**
 * The id the inverted guard admits. Exported so the test names the same string
 * this table does: a guard scoped to a literal typed out twice stops being
 * scoped the moment one copy is renamed.
 */
export const UNREGISTERED_GENESIS_VECTOR = "095-genesis-unregistered-version";

export const genesisRegistrationVectors: Vector[] = [
  bad(
    UNREGISTERED_GENESIS_VECTOR,
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          RESERVED_VERSION,
          {
            chain_id: chainId(OPERATOR.publicKeyHex),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex,
            registrar_pk: REGISTRAR.publicKeyHex,
          },
          { signer: OPERATOR },
        ),
      ),
    ),
    1,
    ["EV-20", "EV-9", "EV-15", "EV-19", "ES-9", "ES-11"],
    "A well-formed genesis at the version EV-19 reserves. Every Stage A check passes — the line is canonical, seq is 1, prev_hash is the 64-zero anchor, and the hash covers the payload and matches — and the payload satisfies ES-10 and ES-15-ES-17, so nothing structural is wrong with it. The ONLY fault is that (genesis, 1000000) is not a pair this verifier registers, which under EV-20 is INVALID at line 1 rather than the PARTIAL that EV-8's forward-compatibility posture would otherwise give it. The version is EV-19's reserved value exactly, so no future contracts version can ever register it and contradict this frozen verdict; the payload is the ordinary four-key genesis so that the unregistered version is the only thing a reader has to weigh. Note what this vector does NOT assert: EV-21's reason text distinguishing 'this verifier is out of date' from 'this genesis is corrupt' is advisory and deliberately fixture-free (EV-17), so conformance here is the token and the line number alone.",
  ),
];
