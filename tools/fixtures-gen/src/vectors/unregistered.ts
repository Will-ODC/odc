// Vectors outside the v1 registry, which a frozen verifier must report PARTIAL
// rather than condemn (EV-7/EV-8/EV-9) — Stage A confirms their integrity, only
// their type-specific semantics go unchecked. This is what stops a frozen
// verifier declaring a chain broken merely because the community legally grew
// past it (charter §8).
//
// Every unregistered TYPE here uses the x_ prefix EV-18 reserves, so no future
// registration can ever contradict a frozen verdict. 009 deliberately does NOT
// use genesis for its unregistered version: an unregistered genesis version
// leaves a verifier unable to extract operator_pk/registrar_pk at all, which is
// an open question a frozen fixture would foreclose.
import { AX, ESC, chain, partial, type Vector } from "./shared.js";
import { keypairFromSeed, seedOf } from "../encode.js";

export const unregisteredVectors: Vector[] = [
  partial(
    "008-unregistered-type",
    AX,
    [5],
    ["EV-7", "EV-8", "EV-18"],
    "Stage A passes on every line including the unknown type; only its type-specific semantics go unchecked. Uses the x_ prefix EV-18 reserves, so no future registration can contradict this frozen verdict.",
  ),
  partial(
    "009-unregistered-version",
    chain((c) => {
      c.participant(0x03);
      c.custom("participant_registered", 2, {
        pubkey: keypairFromSeed(seedOf(0x04)).publicKeyHex,
      });
    }),
    [3],
    ["ET-2", "EV-8"],
    "A registered type at an unregistered version. Deliberately NOT genesis: an unregistered genesis version would leave a verifier unable to extract operator_pk/registrar_pk for Stage B at all, which is an unresolved question and must not be frozen into a fixture.",
  ),
  partial(
    "010-unregistered-type-empty-payload",
    chain((c) => c.custom("x_empty", 1, {})),
    [2],
    ["HA-8"],
    "The k=0 payload encoding: U64(0) and nothing more. No v1 type has an empty payload, so only an x_ type can pin this.",
  ),
  partial(
    "011-unregistered-type-escapes",
    ESC,
    [2],
    ["EX-9", "HA-2"],
    "Every EX-9 branch in one string: all five short escapes (\\t \\n \\b \\f \\r), \\u001f in lowercase hex, escaped quote and backslash, literal solidus, literal non-ASCII. The \\r is inside a string value, which EX-9 governs independently of EX-3's ban on a raw CR between lines. No v1 type may carry a control character, so an x_ type is the only way to pin the control-character branches.",
  ),
];
