import { Chain, genesis } from "./odc.mjs";
import { readFileSync } from "node:fs";
const c = new Chain();
const g = genesis(c);
console.log(
  "hash",
  g.hash,
  g.hash === "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a"
    ? "MATCHES hashing.md §6"
    : "MISMATCH",
);
console.log("sig matches §6:", g.payload.sig.startsWith("631d1b8001d674f4"));
const fx = readFileSync(
  process.argv[2] + "/contracts/fixtures/vectors/001-genesis-only.ndjson",
  "utf8",
);
console.log("byte-identical to fixture 001:", fx === c.text());
