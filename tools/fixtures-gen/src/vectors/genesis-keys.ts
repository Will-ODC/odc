// INVALID vectors for the genesis key FORMAT (event-types.md ET-9b).
//
// ET-9b requires operator_pk and registrar_pk to be 64 LOWERCASE hex, rejected
// and never lowercased to conform (D5) — the same rule ids.md ID-3/ID-2 fix for
// participant_registered.pubkey. Until ET-9b that constraint lived only in the
// genesis payload table, cited by no numbered sentence and, more importantly,
// exercised by no vector: a verifier that skipped the check passed all 75
// preceding vectors with no signal (see memory/OPEN-QUESTIONS.md, the same shape
// as the ET-14 U+007F gap 074 closed).
//
// The malformation is an UPPERCASE key, and that is the whole design. Uppercase
// hex still decodes to the identical 32 bytes, so chain_id still derives (ET-7),
// the genesis self-signature still verifies (ET-8), the line is canonical and the
// hash matches — the ONLY thing wrong is the case. That isolation is what
// 033-prev-hash-uppercase and 036-hash-uppercase already have for their fields.
// A wrong-LENGTH key would break hex decoding, so the derivation and signature
// would fail too, and the vector could no longer separate ET-9b from ET-7/ET-8.
//
// One vector per key, not one for both: registrar_pk is the one an implementation
// forgets, because it does not enter chain_id (ET-7) and is unused until a ballot
// arrives — the same asymmetry 074/075 exist to catch.
//
// Built with custom("genesis", …), the 059-chain-id-not-derived mechanism: the
// payload carries the uppercase key string (so `hash` covers it and matches),
// while chainId() is fed the real lowercase key (so the derivation stays valid).
// chainId()/participantId() REJECT uppercase since PR #22, so the key cannot
// simply be handed to them, and uppercasing after the fact with editLine would
// leave `hash` — which covers the payload string — mismatched, failing the vector
// for two reasons instead of one.

import { bad, headless, lines, type Vector } from "./shared.js";
import { OPERATOR, REGISTRAR } from "../chain.js";
import { chainId } from "../encode.js";

export const genesisKeysVectors: Vector[] = [
  bad(
    "076-genesis-operator-pk-uppercase",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            chain_id: chainId(OPERATOR.publicKeyHex),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex.toUpperCase(),
            registrar_pk: REGISTRAR.publicKeyHex,
          },
          { signer: OPERATOR },
        ),
      ),
    ),
    1,
    ["ET-9b"],
    "operator_pk in UPPERCASE hex. ET-9b requires 64 lowercase hex, rejected and never lowercased to conform (D5). The uppercase string decodes to the same 32 bytes, so chain_id = sha256(those bytes) still matches (ET-7) and the genesis self-signature still verifies under the decoded key (ET-8); the hash is recomputed over the uppercase payload and matches. Only the case is wrong, so a verifier omitting the ET-9b format check reports VALID.",
  ),
  bad(
    "077-genesis-registrar-pk-uppercase",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            chain_id: chainId(OPERATOR.publicKeyHex),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex,
            registrar_pk: REGISTRAR.publicKeyHex.toUpperCase(),
          },
          { signer: OPERATOR },
        ),
      ),
    ),
    1,
    ["ET-9b"],
    "registrar_pk in UPPERCASE hex. Same defect as 076 on the OTHER key — the one an implementation is likelier to skip, since registrar_pk never enters chain_id (ET-7) and is unused until a vote_cast arrives (ET-17). chain_id derives from operator_pk (lowercase) and matches, and the genesis is operator-self-signed so the signature never consults registrar_pk; the hash covers the uppercase registrar_pk and matches. Only ET-9b fails.",
  ),
];
