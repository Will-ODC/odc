import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Chain, genesis, OP, sha, isoMs } from "./odc.mjs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const lp = (b) => Buffer.concat([u64(b.length), b]);
// issue_created with a raw-byte title; keys sorted: ballot_batch_interval_ms, ballot_batch_min, choice_count, sig, title
function issueLine(seq, prev, rawTitle, titleOnLine) {
  const ts = isoMs(Date.parse("2026-08-01T10:00:00.000Z"));
  const ints = [
    ["ballot_batch_interval_ms", 60000],
    ["ballot_batch_min", 3],
    ["choice_count", 2],
  ];
  const enc = (withSig, sig) => {
    const parts = [u64(withSig ? 5 : 4)];
    for (const [k, v] of ints)
      parts.push(Buffer.from([0x69]), lp(Buffer.from(k)), u64(v));
    if (withSig)
      parts.push(
        Buffer.from([0x73]),
        lp(Buffer.from("sig")),
        lp(Buffer.from(sig)),
      );
    parts.push(Buffer.from([0x73]), lp(Buffer.from("title")), lp(rawTitle));
    return Buffer.concat([
      Buffer.from("ODC1"),
      u64(seq),
      lp(Buffer.from("issue_created")),
      u64(1),
      ...parts,
      lp(Buffer.from(ts)),
      lp(Buffer.from(prev)),
    ]);
  };
  const sig = crypto.sign(null, enc(false), OP.priv).toString("hex");
  const hash = sha(enc(true, sig));
  return Buffer.concat([
    Buffer.from(
      `{"seq":${seq},"type":"issue_created","version":1,"payload":{"ballot_batch_interval_ms":60000,"ballot_batch_min":3,"choice_count":2,"sig":"${sig}","title":"`,
    ),
    titleOnLine,
    Buffer.from(`"},"ts":"${ts}","prev_hash":"${prev}","hash":"${hash}"}\n`),
  ]);
}
const c = new Chain();
const g = genesis(c);
const cases = {
  "lone-surrogate-raw": Buffer.from([0x61, 0xed, 0xa0, 0x80]),
  "overlong-nul": Buffer.from([0x61, 0xc0, 0x80]),
  "byte-f5": Buffer.from([0x61, 0xf5, 0x80, 0x80, 0x80]),
  "truncated-seq": Buffer.from([0x61, 0xe2, 0x82]),
};
for (const [n, raw] of Object.entries(cases))
  writeFileSync(
    `${out}/utf8-${n}.ndjson`,
    Buffer.concat([Buffer.from(c.text()), issueLine(2, g.hash, raw, raw)]),
  );
// \ud800 escape on the line; hash over the WTF-8 bytes a lenient decoder would produce
writeFileSync(
  `${out}/utf8-escaped-surrogate.ndjson`,
  Buffer.concat([
    Buffer.from(c.text()),
    issueLine(
      2,
      g.hash,
      Buffer.from([0x61, 0xed, 0xa0, 0x80]),
      Buffer.from("a\\ud800"),
    ),
  ]),
);
// and hash over U+FFFD (Go-style substitution) with raw bytes on line
writeFileSync(
  `${out}/utf8-fffd-substituted.ndjson`,
  Buffer.concat([
    Buffer.from(c.text()),
    issueLine(
      2,
      g.hash,
      Buffer.from("a���", "utf8"),
      Buffer.from([0x61, 0xed, 0xa0, 0x80]),
    ),
  ]),
);
console.log("ok");
