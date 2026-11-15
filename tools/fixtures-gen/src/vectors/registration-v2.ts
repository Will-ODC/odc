import { sign } from "node:crypto";

import type { ChainBuilder } from "../chain.js";
import { ENC_INT, ENC_PAYLOAD, ENC_STR, type Payload } from "../encode.js";
import {
  CANONICAL_IDENTITY,
  DEGENERATE_SIG,
  NONCANONICAL_POINT,
  badR,
  bumpSByL,
} from "./canonical-ed25519.js";
import { GENESIS_EVENT, P3, bad, chain, forked, lines, ok } from "./shared.js";

const TYPE = "participant_registered";
const VERSION = 2;
const GENESIS = GENESIS_EVENT.hash;
const PAYLOAD = { pubkey: P3.publicKeyHex };

/** HA-15a over the payload before the signature is inserted. */
export function registrationPreimage(
  genesisHash: string,
  payload: Payload,
): Buffer {
  return Buffer.concat([
    Buffer.from("ODC-REG2", "ascii"),
    ENC_STR(TYPE),
    ENC_INT(VERSION),
    ENC_STR(genesisHash),
    ENC_PAYLOAD(payload),
  ]);
}

const signRegistration = (payload: Payload): string =>
  sign(null, registrationPreimage(GENESIS, payload), P3.privateKey).toString(
    "hex",
  );

const SIGNATURE = signRegistration(PAYLOAD);

function register(c: ChainBuilder, sig = SIGNATURE, pubkey = P3.publicKeyHex) {
  return c.custom(TYPE, VERSION, { pubkey, sig });
}

export const registrationV2Vectors = [
  ok(
    "151-registration-v2",
    chain((c) => register(c)),
    ["ET-2", "ET-10a", "HA-15a", "HA-16"],
    "A self-signed version 2 registration over the genesis hash. Uses the key and preimage of the worked example in hashing.md §7.",
  ),
  ok(
    "152-registration-v2-delayed",
    chain((c) => {
      c.issue("Adopt the charter", 3);
      register(c);
    }),
    ["ET-10a", "HA-15a"],
    "The very same signature as 151 still verifies after an issue changes the registration's seq, ts and prev_hash.",
  ),
  ok(
    "153-registration-v2-duplicate",
    chain((c) => {
      register(c);
      register(c);
    }),
    ["ET-10a", "ET-12", "HA-15a"],
    "Two correctly linked events carry the same public key and signature. Reusing the registration signature on the same chain is valid.",
  ),
  bad(
    "154-registration-v2-signed-as-v1",
    lines(chain((c) => c.custom(TYPE, VERSION, PAYLOAD, { signer: P3 }))),
    2,
    ["ET-10a", "HA-15", "HA-15a", "HA-16"],
    "Uses the HA-15 signing construction over the version 2 envelope. The event hash is correct, but the signature fails HA-15a.",
  ),
  bad(
    "155-registration-v1-signed-as-v2",
    lines(chain((c) => c.custom(TYPE, 1, { ...PAYLOAD, sig: SIGNATURE }))),
    2,
    ["ET-10", "HA-15", "HA-15a", "HA-16"],
    "Uses the valid version 2 signature from 151 on a version 1 event. Version 1 still requires HA-15.",
  ),
  bad(
    "156-registration-v2-other-genesis",
    lines(forked({ ts: "2026-07-20T23:59:59.999Z" }, (c) => register(c))),
    2,
    ["ET-7a", "ET-10a", "HA-15a"],
    "The signature from 151 is replayed on a chain with the same operator key and chain_id but a different genesis hash. The line links to the new genesis.",
  ),
  bad(
    "157-registration-v2-extra-key",
    lines(
      chain((c) => {
        const payload = { ...PAYLOAD, extra: 1 };
        c.custom(TYPE, VERSION, { ...payload, sig: signRegistration(payload) });
      }),
    ),
    2,
    ["ES-18", "ET-10a"],
    "The payload contains an extra scalar. Its signature covers that extra field as well, so the exact payload key-set check is required.",
  ),
  bad(
    "158-registration-v2-noncanonical-s",
    lines(chain((c) => register(c, bumpSByL(SIGNATURE)))),
    2,
    ["ET-4a", "ET-10a"],
    "Replaces S with S + L and recomputes the event hash. The version 2 path still rejects non-canonical S.",
  ),
  bad(
    "159-registration-v2-noncanonical-r",
    lines(chain((c) => register(c, badR(SIGNATURE)))),
    2,
    ["ET-4a", "ET-10a"],
    "Replaces R with an encoding whose y-coordinate is at least p. The event hash covers the changed signature.",
  ),
  bad(
    "160-registration-v2-noncanonical-key",
    lines(chain((c) => register(c, DEGENERATE_SIG, NONCANONICAL_POINT))),
    2,
    ["ET-4b", "ET-10a"],
    "Uses a non-canonical encoding of the identity point with a canonical degenerate signature. Already-invalid key encoding must be rejected before the subgroup check.",
  ),
  bad(
    "161-registration-v2-smallorder-key",
    lines(chain((c) => register(c, DEGENERATE_SIG, CANONICAL_IDENTITY))),
    2,
    ["ET-4c", "ET-10a"],
    "Uses the canonical identity point as the public key and a canonical degenerate signature. The prime-order key check still rejects it.",
  ),
];
