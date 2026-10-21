import { Chain, genesis, OP, REG, key, isoMs } from "./odc.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [, , outDir, GO, TS, Nstr, seedStr] = process.argv;
mkdirSync(outDir, { recursive: true });
let s = Number(seedStr || 1) >>> 0;
const rnd = () => {
  s = (s + 0x9e3779b9) >>> 0;
  let z = s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return ((z ^ (z >>> 16)) >>> 0) / 2 ** 32;
};
const pick = (a) => a[Math.floor(rnd() * a.length)],
  chance = (p) => rnd() < p;
const T0 = Date.parse("2026-08-01T10:00:00.000Z");
const PK = key("55".repeat(32));
function build() {
  const c = new Chain();
  genesis(c);
  const issues = [];
  const nI = 1 + Math.floor(rnd() * 3);
  let made = 0;
  const steps = 4 + Math.floor(rnd() * 14);
  for (let st = 0; st < steps; st++) {
    if (made < nI && (issues.length === 0 || chance(0.25))) {
      const reg = chance(0.8),
        d = pick([60000, 120000]),
        m = pick([3, 3, 4]);
      const e = reg
        ? c.add(
            "issue_created",
            1,
            {
              title: "I" + made,
              choice_count: pick([2, 3]),
              ballot_batch_interval_ms: d,
              ballot_batch_min: m,
            },
            isoMs(T0),
            OP,
          )
        : c.add(
            "issue_created",
            1000000,
            { title: "U" + made, x: 1 },
            isoMs(T0),
            null,
          );
      issues.push({ hash: e.hash, reg });
      made++;
      continue;
    }
    if (chance(0.06)) {
      c.add(
        "participant_registered",
        1,
        { pubkey: PK.pk },
        isoMs(T0 + Math.floor(rnd() * 1e6)),
        PK,
      );
      continue;
    }
    const iss = pick(issues),
      opaque = chance(0.3);
    let ts = T0 + 60000 * pick([1, 2, 3, 4]);
    if (chance(0.04)) ts += 1;
    let choice = Math.floor(rnd() * 2);
    if (chance(0.03)) choice = 5;
    const iid = chance(0.03) ? "ab".repeat(32) : iss.hash;
    c.add(
      "vote_cast",
      opaque ? 1000000 : 1,
      { issue_id: iid, choice },
      isoMs(ts),
      REG,
    );
  }
  return c;
}
const parse = (o) => {
  o = o.trim();
  if (o === "VALID") return "VALID";
  let m = o.match(/^INVALID at line (\d+)/);
  if (m) return "INVALID " + m[1];
  m = o.match(/^PARTIAL at lines? ([\d, ]+)/);
  if (m) return "PARTIAL " + m[1].replace(/\s/g, "");
  return "?? " + o;
};
const N = Number(Nstr);
const tally = {};
let dis = 0;
for (let i = 0; i < N; i++) {
  const c = build();
  const f = `${outDir}/case.ndjson`;
  writeFileSync(f, c.text());
  const g = parse(spawnSync(GO, [f], { encoding: "utf8" }).stdout),
    t = parse(spawnSync("node", [TS, f], { encoding: "utf8" }).stdout);
  const k = g.split(" ")[0];
  tally[k] = (tally[k] || 0) + 1;
  if (g !== t) {
    dis++;
    writeFileSync(`${outDir}/disagree-${dis}.ndjson`, c.text());
    console.log("DISAGREE", i, "go:", g, "ts:", t);
    if (dis > 10) break;
  }
}
console.log(
  `cases ${N}, disagreements ${dis}, go verdict mix`,
  JSON.stringify(tally),
);
