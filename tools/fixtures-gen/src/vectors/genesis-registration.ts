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
export const UNREGISTERED_GENESIS_VECTORS = [
  "095-genesis-unregistered-version",
  "096-genesis-unregistered-version-continues",
] as const;

export const genesisRegistrationVectors: Vector[] = [
  bad(
    UNREGISTERED_GENESIS_VECTORS[0],
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
    "A well-formed genesis at the version EV-19 reserves. Every Stage A check passes — the line is canonical, seq is 1, prev_hash is the 64-zero anchor, and the hash covers the payload and matches — and the payload satisfies ES-10 and ES-15-ES-17, so nothing structural is wrong with it. The only fault a verifier can REACH is that (genesis, 1000000) is not a pair it registers, which under EV-20 is INVALID at line 1 rather than the PARTIAL that EV-8's forward-compatibility posture would otherwise give it. These bytes also break ET-6, which fixes genesis.version at 1 — but ET-6 is an ET-* rule and EV-15 assigns every one of those to Stage B, which never runs for an unregistered pair, so no verifier can cite it here and neither the verdict nor the line depends on it. The version is EV-19's reserved value exactly, so no future contracts version can ever register it and contradict this frozen verdict; the payload is the ordinary four-key genesis so that the unregistered version is the only thing a reader has to weigh. Note what this vector does NOT assert: EV-21's reason text distinguishing 'this verifier is out of date' from 'this genesis is corrupt' is advisory and deliberately fixture-free (EV-17), so conformance here is the token and the line number alone.",
  ),
  bad(
    UNREGISTERED_GENESIS_VECTORS[1],
    lines(
      headless((c) => {
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
        );
        c.participant(0x03);
      }),
    ),
    1,
    ["EV-20", "EV-17", "EV-9", "EV-15", "EV-19"],
    "The same unregistered genesis, FOLLOWED BY a normal event at a registered version — the audit's downgrade.ndjson shape, and the vector ADR-0015 actually asks for. 095 alone cannot do this job and the difference is the whole point. The defect ADR-0015 records is a LINE ATTRIBUTION defect, not a verdict one: both verifiers once reached INVALID by convergent reasoning at line 2, blaming the first event whose signature they could not check rather than the genesis that made it uncheckable. A one-line chain has no line 2 to blame, so it cannot separate a verifier that stops at the unregistered genesis from one that walks on. Here the second line is well-formed, correctly linked and correctly signed under the operator key the genesis declares, so nothing about line 2 is wrong except that a verifier which got past line 1 has no key to check it with. EV-20 says the verifier MUST NOT proceed, and EV-17 names the first fatal line: 1, not 2.",
  ),
  bad(
    "097-genesis-undefined-key",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            ancestor_seq: 50,
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
    ["ES-18", "ES-34", "ET-9e"],
    "A genesis carrying a key the (genesis, 1) key set does not define. ES-34 is explicit that this is the hazard optionality creates: OPTIONAL means 'this defined key may be absent', NEVER 'an undefined key may appear', and a verifier still rejects any key not defined for the pair. The key is named ancestor_seq on purpose — it is what a fork's genesis plausibly WANTS (a fork at seq 50 and one at seq 5000 are different claims) and it is exactly what ET-9e chose not to provide, recording the position as a head instead. A verifier that implemented the two new keys as 'required keys present, unknown keys ignored' passes every other vector in this corpus and accepts this one. The only ES-18 vectors before this were 067/068, both at line 2 on participant_registered, so the genesis key set itself was unfixtured on both halves.",
  ),
  bad(
    "098-genesis-missing-registrar-pk",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            chain_id: chainId(OPERATOR.publicKeyHex),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex,
          },
          { signer: OPERATOR },
        ),
      ),
    ),
    1,
    ["ES-18", "ES-34", "ET-9a"],
    "A genesis with registrar_pk absent entirely. This is the other half of ES-18 on the genesis key set, and it is the likelier mistake of the two: 'make these two ancestry keys optional' is precisely the edit that touches the required-key list, and a verifier that loosens one key too many accepts a chain with no registrar at all — silently defeating ET-9a, ET-9d and ET-17 together, since every ballot signature check then has no key to run against. 083 and 094 cannot catch it because both carry registrar_pk; they exercise its VALUE, and nothing until now exercised its PRESENCE. Note this is not the ET-9d fault in another form: 094 declares one key twice and is visible in the log as a collapse, while this chain declares no registrar at all. Which rule a verifier cites is deliberately not pinned — ES-18 rejects the key set and ET-9b rejects the absent key's format, both reaching INVALID at line 1, and EV-17 makes the token and the line the whole of conformance. A verifier with both barriers is unaffected by loosening either one alone, which is a property worth having rather than a gap in this vector.",
  ),
];
