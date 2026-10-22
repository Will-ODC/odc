// Adversarial chains for the third T9 re-audit, built with the spec-only
// encoder from the first re-audit (../t9-reaudit-2026-10-20/odc.mjs).
//
// Usage: node attacks3.mjs <out-dir>
// Writes one .ndjson per case and cases.json (expected verdict and line).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Chain,
  genesis,
  OP,
  REG,
  key,
  isoMs,
} from "../t9-reaudit-2026-10-20/odc.mjs";

const out = process.argv[2];
if (!out) {
  console.error("usage: node attacks3.mjs <out-dir>");
  process.exit(64);
}
mkdirSync(out, { recursive: true });

const T0 = Date.parse("2026-08-01T10:00:00.000Z");
const MIN = 60000;
const cases = [];
const save = (name, text, want, note) => {
  writeFileSync(join(out, `${name}.ndjson`), text);
  cases.push({ name, want, note });
};

function withIssue(c, min, title) {
  return c.add(
    "issue_created",
    1,
    {
      title,
      choice_count: 2,
      ballot_batch_interval_ms: MIN,
      ballot_batch_min: min,
    },
    isoMs(T0),
    OP,
  );
}
const vote = (c, iss, choice, ms) =>
  c.add("vote_cast", 1, { issue_id: iss.hash, choice }, isoMs(ms), REG);

// 1. T3-1. A batch is sealed holding exactly ballot_batch_min (3) admitted
// ballots. At append time the registrar re-checks eligibility (ET-20 says
// "before the registrar signs", and it signs at append, ET-25) and refuses
// one. The two it signs form an under-size tail: VALID, so EV-26 lets the
// ledger append them. The issue's next full batch is then unappendable.
{
  const c = new Chain();
  genesis(c);
  const iss = withIssue(c, 3, "Shall the treasury fund plan Y?");
  vote(c, iss, 1, T0 + MIN);
  vote(c, iss, 0, T0 + MIN);
  save(
    "registrar-refuses-after-seal",
    c.text(),
    "VALID",
    "sealed batch of 3, one refused at signing: two-ballot tail",
  );
  vote(c, iss, 1, T0 + 2 * MIN);
  vote(c, iss, 1, T0 + 2 * MIN);
  vote(c, iss, 0, T0 + 2 * MIN);
  save(
    "registrar-refuses-then-next-batch",
    c.text(),
    "INVALID 5",
    "every later batch of the issue is stranded (EV-26 forbids it)",
  );
}

// 2. T3-3. ET-25 says that once an under-size batch is appended, EV-26
// forbids appending any later ballot of that issue. A ballot at the same
// instant, with no other ballot of the issue in between, only extends the
// batch and stays VALID. It is ET-25's seal, not EV-26, that forbids it.
{
  const c = new Chain();
  genesis(c);
  const iss = withIssue(c, 3, "Shall the treasury fund plan Z?");
  vote(c, iss, 1, T0 + MIN);
  vote(c, iss, 0, T0 + MIN);
  const reg = key("05".repeat(32));
  c.add("participant_registered", 1, { pubkey: reg.pk }, isoMs(T0 + 7), reg);
  vote(c, iss, 1, T0 + MIN);
  save(
    "undersize-tail-extended-same-instant",
    c.text(),
    "VALID",
    "a later ballot at the tail batch's instant is not barred by EV-26",
  );
}

// 3. One open batch per issue (ET-25 rules 1 to 3) across two issues. Issue
// A's batch is appended in one run while issue B's ballots fall between its
// members, which ET-24 allows. A conforming interleaving must be VALID.
{
  const c = new Chain();
  genesis(c);
  const a = withIssue(c, 3, "Issue A");
  const b = withIssue(c, 3, "Issue B");
  vote(c, a, 0, T0 + MIN);
  vote(c, b, 1, T0 + 3 * MIN);
  vote(c, a, 1, T0 + MIN);
  vote(c, b, 1, T0 + 3 * MIN);
  vote(c, a, 0, T0 + MIN);
  vote(c, b, 0, T0 + 3 * MIN);
  vote(c, a, 1, T0 + 2 * MIN);
  save(
    "two-issues-interleaved-runs",
    c.text(),
    "VALID",
    "per-issue runs interleaved across issues; A's last batch under-size",
  );
}

writeFileSync(join(out, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`);
console.log(`wrote ${cases.length} cases to ${out}`);
