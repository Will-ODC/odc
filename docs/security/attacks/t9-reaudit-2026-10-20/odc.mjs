// Independent encoder written from contracts/hashing.md + export-format.md prose only.
import crypto from "node:crypto";
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const lp = (buf) => Buffer.concat([u64(buf.length), buf]);
const encStr = (s) => lp(Buffer.from(s, "utf8"));
const cmpKeys = (a, b) =>
  Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
function encPayload(p) {
  const keys = Object.keys(p).sort(cmpKeys);
  const parts = [u64(keys.length)];
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "number")
      parts.push(Buffer.from([0x69]), encStr(k), u64(v));
    else parts.push(Buffer.from([0x73]), encStr(k), encStr(v));
  }
  return Buffer.concat(parts);
}
export function pre(e) {
  return Buffer.concat([
    Buffer.from("ODC1", "ascii"),
    u64(e.seq),
    encStr(e.type),
    u64(e.version),
    encPayload(e.payload),
    encStr(e.ts),
    encStr(e.prev_hash),
  ]);
}
export const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
export function key(seedHex) {
  const der = Buffer.from("302e020100300506032b657004220420" + seedHex, "hex");
  const priv = crypto.createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });
  const pub = crypto
    .createPublicKey(priv)
    .export({ format: "der", type: "spki" })
    .subarray(12);
  return { priv, pk: pub.toString("hex"), raw: pub };
}
export function line(e) {
  const keys = Object.keys(e.payload).sort(cmpKeys);
  const pl =
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + JSON.stringify(e.payload[k]))
      .join(",") +
    "}";
  return `{"seq":${e.seq},"type":${JSON.stringify(e.type)},"version":${e.version},"payload":${pl},"ts":${JSON.stringify(e.ts)},"prev_hash":"${e.prev_hash}","hash":"${e.hash}"}`;
}
export const ZERO = "0".repeat(64);
export class Chain {
  constructor() {
    this.events = [];
  }
  get head() {
    return this.events.length ? this.events.at(-1).hash : ZERO;
  }
  add(type, version, payload, ts, signer) {
    const e = {
      seq: this.events.length + 1,
      type,
      version,
      payload: { ...payload },
      ts,
      prev_hash: this.head,
    };
    if (signer)
      e.payload.sig = crypto.sign(null, pre(e), signer.priv).toString("hex"); // pre() w/o sig = SIGN_PRE
    e.hash = sha(pre(e));
    this.events.push(e);
    return e;
  }
  text() {
    return this.events.map((e) => line(e) + "\n").join("");
  }
  clone() {
    const c = new Chain();
    c.events = this.events.map((e) => ({ ...e, payload: { ...e.payload } }));
    return c;
  }
}
export const OP = key("01".repeat(32)),
  REG = key("02".repeat(32));
export function genesis(
  c,
  ts = "2026-07-21T00:00:00.000Z",
  extra = {},
  op = OP,
  reg = REG,
) {
  return c.add(
    "genesis",
    1,
    {
      chain_id: sha(op.raw),
      contracts: "contracts-v1",
      operator_pk: op.pk,
      registrar_pk: reg.pk,
      ...extra,
    },
    ts,
    op,
  );
}
export const isoMs = (ms) => new Date(ms).toISOString();
