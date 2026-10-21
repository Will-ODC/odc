// Adversarial chains for the second T9 re-audit, built with the spec-only
// encoder from the first re-audit (../t9-reaudit-2026-10-20/odc.mjs).
//
// Usage: node attacks2.mjs <out-dir>
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
  line,
  pre,
  sha,
} from "../t9-reaudit-2026-10-20/odc.mjs";

const out = process.argv[2];
if (!out) {
  console.error("usage: node attacks2.mjs <out-dir>");
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

function withIssue(min = 3) {
  const c = new Chain();
  genesis(c);
  const iss = c.add(
    "issue_created",
    1,
    {
      title: "Shall the treasury fund plan Y?",
      choice_count: 2,
      ballot_batch_interval_ms: MIN,
      ballot_batch_min: min,
    },
    isoMs(T0),
    OP,
  );
  return { c, iss };
}
const vote = (c, iss, choice, ms) =>
  c.add("vote_cast", 1, { issue_id: iss.hash, choice }, isoMs(ms), REG);

// 1. Sealed under-size batch, then the next sealed batch. The first export
// is VALID (an issue's last batch may be small, ET-24), so EV-26 lets a
// ledger append it. Every later batch of that issue is then unappendable:
// the export with it is INVALID at its first ballot. ET-25 says a sealed
// batch is "appended in full"; EV-26 forbids appending it at all.
{
  const { c, iss } = withIssue(3);
  vote(c, iss, 1, T0 + MIN);
  vote(c, iss, 0, T0 + MIN);
  save("undersize-tail", c.text(), "VALID", "two-ballot tail batch, min 3");
  vote(c, iss, 1, T0 + 2 * MIN);
  vote(c, iss, 1, T0 + 2 * MIN);
  vote(c, iss, 0, T0 + 2 * MIN);
  save(
    "undersize-then-next-batch",
    c.text(),
    "INVALID 5",
    "the next sealed batch cannot be appended (EV-26 vs ET-25)",
  );
}

// 2. A registrant's self-signature binds seq, ts and prev_hash (HA-15). A
// registration signed for one position and placed one line later, because
// another event was appended first, fails ET-10.
{
  const { c } = withIssue(3);
  const alice = key("03".repeat(32));
  const signedFor = c.clone();
  signedFor.add(
    "participant_registered",
    1,
    { pubkey: alice.pk },
    isoMs(T0 + 5),
    alice,
  );
  const sig = signedFor.events.at(-1).payload.sig;
  const bob = key("04".repeat(32));
  c.add("participant_registered", 1, { pubkey: bob.pk }, isoMs(T0 + 4), bob);
  const e = {
    seq: c.events.length + 1,
    type: "participant_registered",
    version: 1,
    payload: { pubkey: alice.pk, sig },
    ts: isoMs(T0 + 5),
    prev_hash: c.head,
  };
  e.hash = sha(pre(e));
  save(
    "registration-moved-one-line",
    c.text() + line(e) + "\n",
    "INVALID 4",
    "a registrant must sign at the final position (HA-15, ET-10)",
  );
}

// 3. Replay of a registrar-signed ballot at a later position fails ET-17.
// Position binding is what stops a ledger duplicating ballots, so any fix to
// S-C that drops seq/prev_hash from the vote_cast signature must replace it.
{
  const { c, iss } = withIssue(3);
  for (let i = 0; i < 3; i += 1) vote(c, iss, 1, T0 + MIN);
  const v = c.events.at(-1);
  const e = {
    seq: c.events.length + 1,
    type: "vote_cast",
    version: 1,
    payload: { ...v.payload },
    ts: v.ts,
    prev_hash: c.head,
  };
  e.hash = sha(pre(e));
  save(
    "ballot-replayed",
    c.text() + line(e) + "\n",
    "INVALID 6",
    "a copied registrar signature does not verify at a new position",
  );
}

// 4. One pubkey registered twice: VALID (ET-12 promises no uniqueness).
{
  const { c } = withIssue(3);
  const alice = key("03".repeat(32));
  c.add(
    "participant_registered",
    1,
    { pubkey: alice.pk },
    isoMs(T0 + 1),
    alice,
  );
  c.add(
    "participant_registered",
    1,
    { pubkey: alice.pk },
    isoMs(T0 + 2),
    alice,
  );
  save("pubkey-registered-twice", c.text(), "VALID", "ET-12");
}

// 5. Batch instants need not be near real time: ballots stamped in 9999.
{
  const { c, iss } = withIssue(3);
  const far = Date.parse("9999-12-31T23:59:00.000Z");
  for (let i = 0; i < 3; i += 1) vote(c, iss, i % 2, far);
  save("far-future-instant", c.text(), "VALID", "ES-21, ET-23");
}

// 6. A genesis declaring the published test keys (0x01..01 / 0x02..02):
// VALID. Nothing refuses them (S-G).
{
  const c = new Chain();
  genesis(c, "2027-01-01T00:00:00.000Z");
  save("test-keys-genesis", c.text(), "VALID", "S-G");
}

writeFileSync(join(out, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`);
console.log(`wrote ${cases.length} cases to ${out}`);
