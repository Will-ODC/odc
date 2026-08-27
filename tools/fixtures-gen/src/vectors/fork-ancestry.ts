// The two OPTIONAL fork-ancestry keys on `genesis` (event-types.md ET-9e,
// ET-9f; event-schema.md ES-34), landed by ADR-0019.
//
// Why this module exists at all: ET-9e, ET-9f and ES-34 were implemented by
// BOTH verifiers and cited by NO vector. EV-17 makes fixtures the sole
// conformance oracle, so until these lines existed the two implementations
// could diverge on every one of these rules and the whole corpus still passed
// both — agreement between two implementers, not verification.
//
// Every value below is computed from a chain this generator builds, never
// hard-coded. A literal 64-hex ancestor would rot silently at the next
// regeneration: the vector would go on asserting a verdict while naming a chain
// that no longer exists anywhere in the corpus, and nothing would fail.
//
// The malformation in each INVALID vector is confined to an ancestry value, and
// each such genesis is signed over the faulty payload and hashed over that
// signature — the 076/077 discipline. A vector that mutated a value and merely
// re-derived `hash` would be satisfied by a verifier that checks only the
// genesis self-signature (ET-8): it would freeze a verdict while catching
// nothing.

import { createHash } from "node:crypto";

import { A, G, forked, lines, ok, bad, type Vector } from "./shared.js";
import { GENESIS_PREV_HASH } from "../chain.js";
import { head as headOf } from "../serialize.js";
import type { Event } from "../encode.js";

/**
 * The parent chain's identity and its head at the fork, taken from the chain
 * `002-four-types` ships. `A` and `G` share a genesis line by construction, so
 * PARENT_CHAIN is also `001-genesis-only`'s only `hash` — which is exactly what
 * makes 087 below expressible without a third base chain.
 */
const PARENT_CHAIN = (A[0] as Event).hash;
const PARENT_HEAD = headOf(A);

/** A parent that has never grown past its genesis: head === identity (EX-14/EX-21). */
const SOLO_CHAIN = (G[0] as Event).hash;
const SOLO_HEAD = headOf(G);

/**
 * A well-formed 64-hex value that is not any event's `hash` anywhere in this
 * corpus — for the vector that pins "a verifier MUST NOT report INVALID because
 * it cannot resolve either value". Derived rather than typed so it cannot
 * collide with a real hash by accident, and so the reason it is unresolvable is
 * legible in the source rather than asserted in a comment.
 */
const unresolvable = (label: string): string =>
  createHash("sha256").update(label).digest("hex");
const UNRESOLVABLE_CHAIN = unresolvable(
  "no chain in this corpus has this genesis hash",
);
const UNRESOLVABLE_HEAD = unresolvable("no chain in this corpus has this head");

/** 63 characters: legal alphabet, wrong length. */
const SHORT_HEAD = PARENT_HEAD.slice(0, 63);

export const forkAncestryVectors: Vector[] = [
  bad(
    "084-ancestor-head-without-chain",
    lines(forked({ ancestorHead: PARENT_HEAD, violates: ["ET-9f"] })),
    1,
    ["ET-9f", "ET-9e", "ES-34", "ET-7a"],
    "A genesis carrying ancestor_head with no ancestor_chain — the one presence combination ET-9f bars, and the head-alone anchoring charter §4 rejects: a position on an UNNAMED chain, which no reader can check because nothing in the payload says which export to open. The value itself is legal (it is 002's true head) and every other rule holds — chain_id derives, the self-signature verifies, the hash covers the payload and matches — so the only fault is the missing companion key. This vector goes first in the ancestry set on purpose: it is the ONLY one that fails against a verifier still implementing the pre-ADR-0019 ET-9e, where ancestor_head stood alone and carried the head. It is the single fixture proving ADR-0019 landed.",
  ),
  ok(
    "085-ancestor-chain-and-head",
    forked({ ancestorChain: PARENT_CHAIN, ancestorHead: PARENT_HEAD }),
    ["ET-9e", "ES-34", "HA-7", "HA-8", "EX-8", "EX-14", "EX-21"],
    "The complete ancestry record: a name and a position, the pair charter §4 requires of an anchoring record. Both values are computed from the chain 002-four-types ships — ancestor_chain is its genesis hash (its identity, ET-7a/EX-21), ancestor_head its last event hash (EX-14). This is the corpus's FIRST seven-key genesis payload, so it is also the first real exercise of HA-7's leading key count U64(7) and of HA-8's ordering: both new keys sort ahead of chain_id, so a payload encoder that emits keys in declaration order rather than byte order produces a different preimage and a hash that does not match.",
  ),
  ok(
    "086-ancestor-chain-alone",
    forked({ ancestorChain: PARENT_CHAIN }),
    ["ET-9f", "ET-9e", "ES-34"],
    "ancestor_chain with no ancestor_head — LEGAL, and the asymmetry is the rule rather than an oversight. It is the weaker but coherent claim 'forked from chain X, fork point unrecorded': a named chain, no position. The pair 084/086 is what pins the asymmetry in both directions, and a verifier that 'tidied' ET-9f into a both-or-neither pair passes 084 and fails here.",
  ),
  ok(
    "087-ancestor-chain-equals-head",
    forked({ ancestorChain: SOLO_CHAIN, ancestorHead: SOLO_HEAD }),
    ["ET-9e", "EX-14", "EX-21"],
    "ancestor_chain and ancestor_head carrying the SAME value — legal, and what a fork from a parent holding only its genesis actually produces: that parent's head IS its genesis hash (EX-14/EX-21), so the name and the position coincide. Both values here are read off 001-genesis-only's chain, not written twice. Nothing in ET-9e bars the equality and nothing should; this is the vector a naive implementer fails by rejecting the two keys as a duplicate, which would make forking a young chain impossible.",
  ),
  bad(
    "088-ancestor-chain-zero",
    lines(forked({ ancestorChain: GENESIS_PREV_HASH, violates: ["ET-9e"] })),
    1,
    ["ET-9e", "ES-24", "ES-34"],
    "ancestor_chain as the 64-zero anchor, which ET-9e bars explicitly. A chain with no recorded ancestor omits both keys (ES-34), so there is exactly one way to say 'no ancestor' and the 64-zero string keeps its single meaning as prev_hash's anchor (ES-24). This vector is the one that catches the plausible wrong reading — that 64 zeros is how a fork says it has no parent — which would give that string two meanings and make absence and the placeholder indistinguishable.",
  ),
  bad(
    "089-ancestor-head-zero",
    lines(
      forked({
        ancestorChain: PARENT_CHAIN,
        ancestorHead: GENESIS_PREV_HASH,
        violates: ["ET-9e"],
      }),
    ),
    1,
    ["ET-9e", "ES-24", "ES-34"],
    "The same 64-zero bar on the OTHER ancestry key, with a legal ancestor_chain alongside it so ET-9f is satisfied and the zero value is the only fault. One vector per key rather than one for both, for the reason 076/077 exist: ancestor_head is the key an implementation is likelier to check less carefully, since ET-9f already forces it to think about ancestor_chain's presence and nothing forces the same attention here.",
  ),
  bad(
    "090-ancestor-chain-uppercase",
    lines(
      forked({
        ancestorChain: PARENT_CHAIN.toUpperCase(),
        violates: ["ET-9e"],
      }),
    ),
    1,
    ["ET-9e", "ID-2", "ES-34"],
    "ancestor_chain in UPPERCASE hex. ET-9e requires ^[0-9a-f]{64}$, and the isolation is the same one 033/036/076 have for their fields: the uppercase string names the same 32 bytes, so a verifier that lowercases before comparing would resolve it to the very chain 002 ships and see nothing wrong. Rejected, never lowercased to conform (D5).",
  ),
  bad(
    "091-ancestor-head-truncated",
    lines(
      forked({
        ancestorChain: PARENT_CHAIN,
        ancestorHead: SHORT_HEAD,
        violates: ["ET-9e"],
      }),
    ),
    1,
    ["ET-9e", "ES-34"],
    "ancestor_head 63 characters long: the legal alphabet, the wrong length. Pairs with 090 to pin both halves of ^[0-9a-f]{64}$ — alphabet and length — on the two different keys, so neither is checked by a regex that got one half right. ancestor_chain is present and legal, so ET-9f holds and the length is the only fault.",
  ),
  ok(
    "092-ancestor-unresolvable",
    forked({
      ancestorChain: UNRESOLVABLE_CHAIN,
      ancestorHead: UNRESOLVABLE_HEAD,
    }),
    ["ET-9e", "ES-34"],
    "A well-formed ancestry pair naming a chain that exists nowhere in this corpus — VALID, and this is the vector most likely to be argued with. Both values are a RECORDED CLAIM, not a verified link: the ancestor is a different export, which the verifier does not hold and cannot demand, so it cannot confirm that ancestor_chain is any chain's genesis hash, that ancestor_head is any chain's head, or that the ancestor exists at all. ET-9e says a verifier MUST NOT report INVALID because it cannot resolve either value and MUST NOT treat an unresolvable value as a defect. A verifier that tries to resolve them — against its own corpus, a registry, anything — fails here, and that failure is the point. The two values are deliberately DIFFERENT: with one value repeated this vector would also die to a verifier that rejects ancestor_chain == ancestor_head, which is 087's job, and the two failures would be indistinguishable.",
  ),
  ok(
    "093-fork-continues",
    forked({ ancestorChain: PARENT_CHAIN, ancestorHead: PARENT_HEAD }, (c) => {
      c.participant(0x03);
      const issue = c.issue("Continue elsewhere", 3);
      c.vote(issue.hash, 1);
    }),
    ["ET-9e", "ET-6", "ES-24", "ES-33", "ET-13", "ET-17"],
    "A fork that goes on to have a life: the same ancestry-bearing genesis as 085, followed by one event of each remaining v1 type. It pins the sentence in ET-9e that says a fork's own structure is unchanged by either key — seq is still 1 and prev_hash is still the 64-zero anchor at the genesis (ET-6, ES-24, ES-33), exactly as on an original chain, and every later event links and verifies normally under the keys this genesis declares. The failure it catches is a verifier that treats a recorded ancestor as a reason to expect continuation — a non-zero prev_hash at line 1, or a seq continuing the parent's — which would make every real fork INVALID.",
  ),
];
