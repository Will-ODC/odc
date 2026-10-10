// `--chain` vectors: chain identity is the genesis hash (EX-21–EX-23, ET-7a,
// ADR-0013). These are the "owed fixtures" of the F1 entry in
// CONTRACTS-CHANGE.md.
//
// Every expected verdict and line here is declared from the spec text, never
// computed by a verifier: a `--chain` value equal to the first line's `hash` is
// accepted (EX-22), any other value is INVALID at line 1 (EX-23), and a `--head`
// given alongside it is checked independently, a mismatch still landing on the
// last line (EX-19).
//
// Two chains are used, both under ONE operator key and ONE registrar key:
//
//   A — vector 002's chain, byte for byte: the four v1 types over the
//       hashing.md §6 genesis.
//   B — the same four events over a genesis one millisecond EARLIER. Its
//       genesis payload is identical to A's (same chain_id, operator_pk,
//       registrar_pk, contracts) and only `ts` differs; every later line
//       differs only because `prev_hash` links to a different genesis hash.
//
// `chain_id` derives from operator_pk alone (ET-7), so it calls A and B the
// same chain. They are not: the genesis hash covers `ts`, so their identities
// differ (ET-7a gives exactly this example, "two chains an operator starts one
// millisecond apart"). The A/B pair is the case export-format.md's acid-test
// walkthrough describes, and it is the only thing in the corpus that fails a
// verifier which implements `--chain` by comparing chain_id, or operator_pk, or
// anything else the two genesis payloads share.
//
// B's genesis is earlier, not later, so every later event of B still carries a
// `ts` after its genesis. ES-21 makes `ts` advisory and nothing orders by it,
// so a later genesis would also be legal; earlier simply avoids a reader
// wondering.
//
// Deliberately NOT here (the spec does not settle them — open question for the
// operator): a run where `--chain` and `--head` BOTH mismatch, and a `--chain`
// mismatch on an export that is already INVALID elsewhere. Either would freeze
// a precedence EX-19/EX-23 do not state.
import { A, Alines, forked, lines, v, type Vector } from "./shared.js";
import { head as headOf } from "../serialize.js";
import { frame } from "../tamper.js";

/** One millisecond before hashing.md §6's GENESIS_TS (ET-7a's own example). */
const B_GENESIS_TS = "2026-07-20T23:59:59.999Z";

/** Vector 002's events over a genesis one millisecond earlier. */
const B = forked({ ts: B_GENESIS_TS }, (c) => {
  c.participant(0x03);
  const issue = c.issue("Adopt the charter", 3);
  c.vote(issue.hash, 1);
});
const Blines = lines(B);

const genesisHash = (events: typeof A): string => {
  const first = events[0];
  if (first === undefined) throw new RangeError("chain has no genesis");
  return first.hash;
};

/** EX-21: the identity of each chain is its first line's `hash`. */
const A_ID = genesisHash(A);
const B_ID = genesisHash(B);

export const chainIdentityVectors: Vector[] = [
  v(
    "109-chain-match",
    frame(Alines),
    { verdict: "VALID" },
    ["EX-21", "EX-22", "ET-7a"],
    "Chain 002 run with --chain set to its own genesis hash (the first line's hash, EX-21), so the EX-22 check passes. The same bytes as 002/003/054; only the --chain input distinguishes them. This is also chain A of the 111/112/113 pair run under its own identity.",
    undefined,
    A_ID,
  ),
  v(
    "110-chain-mismatch",
    frame(Alines),
    { verdict: "INVALID", line: 1 },
    ["EX-22", "EX-23"],
    "Chain 002 run with --chain set to a hash that is not its genesis hash. The value is deliberately this export's own HEAD — the last line's hash, a real hash in this very chain — so a verifier that wired --chain to the --head comparison (EX-15) wrongly accepts it. Every link check passes; the mismatch alone is fatal, and EX-23 attributes it to line 1, the line whose hash was compared.",
    undefined,
    headOf(A),
  ),
  v(
    "111-chain-a-under-b",
    frame(Alines),
    { verdict: "INVALID", line: 1 },
    ["EX-21", "EX-22", "EX-23", "ET-7", "ET-7a"],
    "Chain A (002's bytes) run with --chain set to chain B's genesis hash (113). A and B are two chains started under ONE operator key: their genesis payloads share chain_id, operator_pk, registrar_pk and contracts. The genesis ts values are one millisecond apart; HA-15/HA-16 therefore require different signatures, and the genesis hashes differ too. chain_id alone would call them the same chain (ET-7); the genesis hash says they are not (ET-7a, ADR-0013). A verifier that implements --chain by comparing chain_id or operator_pk accepts this. INVALID at line 1 per EX-23.",
    undefined,
    B_ID,
  ),
  v(
    "112-chain-b-under-a",
    frame(Blines),
    { verdict: "INVALID", line: 1 },
    ["EX-21", "EX-22", "EX-23", "ET-7", "ET-7a"],
    "The mirror of 111: chain B run with --chain set to chain A's genesis hash. B is 002's four events over a genesis one millisecond earlier, under the same operator and registrar keys, so its chain_id equals A's while its identity does not (ET-7, ET-7a, ADR-0013). Both directions are pinned so a verifier cannot pass by special-casing the §6 genesis. INVALID at line 1 per EX-23.",
    undefined,
    A_ID,
  ),
  v(
    "113-chain-b-match",
    frame(Blines),
    { verdict: "VALID" },
    ["EX-21", "EX-22", "ET-7a"],
    "Chain B run with --chain set to its own genesis hash. This is what makes 112 mean something: B is a valid chain in its own right, so 112's INVALID can only come from the identity mismatch, not from a fault in B. (A under its own identity is 109.)",
    undefined,
    B_ID,
  ),
  v(
    "114-chain-and-head-match",
    frame(Alines),
    { verdict: "VALID" },
    ["EX-15", "EX-22"],
    "Chain 002 run with BOTH --chain (its genesis hash) and --head (its last line's hash), each correct. EX-22 makes the two inputs independent and allows them together: --chain fixes which chain, --head how much of it. A verifier that accepts only one of the two flags, or lets one override the other, fails here or at 115.",
    headOf(A),
    A_ID,
  ),
  v(
    "115-chain-match-head-mismatch",
    frame(Alines),
    { verdict: "INVALID", line: 4 },
    ["EX-15", "EX-19", "EX-22"],
    "Chain 002 run with the correct --chain and a wrong --head — chain B's head, a real head of another chain under the same operator key. The --chain check passes, so the --head check must still run and still reject, and EX-19 still attributes a --head mismatch to the last line (4), not to line 1. A verifier that stops checking once --chain matches, or that blames line 1 for any identity input, fails here.",
    headOf(B),
    A_ID,
  ),
];
