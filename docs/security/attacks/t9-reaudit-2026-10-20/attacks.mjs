import { Chain, genesis, OP, REG, key, isoMs } from "./odc.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const T0 = Date.parse("2026-08-01T10:00:00.000Z");
function election(gts, choices) {
  const c = new Chain();
  genesis(c, gts);
  const iss = c.add(
    "issue_created",
    1,
    {
      title: "Shall the treasury fund plan Y?",
      choice_count: 2,
      ballot_batch_interval_ms: 60000,
      ballot_batch_min: 3,
    },
    isoMs(T0),
    OP,
  );
  choices.forEach((ch, i) =>
    c.add(
      "vote_cast",
      1,
      { issue_id: iss.hash, choice: ch },
      isoMs(T0 + 60000 * (1 + Math.floor(i / 3))),
      REG,
    ),
  );
  return c;
}
const save = (n, c) => {
  writeFileSync(`${out}/${n}.ndjson`, c.text());
  return c;
};
// F1 re-test: two chains, one operator key, 1 ms apart, opposite outcomes
const A = save(
  "f1-chainA",
  election("2026-08-01T00:00:00.000Z", [1, 1, 1, 1, 1, 0]),
);
const B = save(
  "f1-chainB",
  election("2026-08-01T00:00:00.001Z", [0, 0, 0, 0, 0, 1]),
);
writeFileSync(
  `${out}/f1-ids.json`,
  JSON.stringify({
    A: A.events[0].hash,
    B: B.events[0].hash,
    headA: A.head,
    headB: B.head,
    chainIdA: A.events[0].payload.chain_id,
    chainIdB: B.events[0].payload.chain_id,
  }),
);
// common-prefix fork: same genesis and first batch, divergent second batch
save("fork-x", election("2026-08-01T00:00:00.000Z", [1, 1, 1, 1, 1, 1]));
// fork with recorded ancestry claiming chain A as parent (claim, not link)
{
  const c = new Chain();
  genesis(c, "2026-08-02T00:00:00.000Z", {
    ancestor_chain: A.events[0].hash,
    ancestor_head: A.head,
  });
  save("fork-ancestry", c);
}
// poison pill: a public registrant submits a bad-signature registration; ledger appends without verifying
{
  const c = election("2026-08-01T00:00:00.000Z", [1, 1, 1]);
  const p = key("33".repeat(32));
  const e = c.add(
    "participant_registered",
    1,
    { pubkey: p.pk },
    "2026-08-01T10:05:00.123Z",
    p,
  );
  // corrupt the sig, then recompute hash so the chain links (the ledger hashed what it was given)
  c.events.pop();
  const bad = { ...e.payload, sig: "00" + e.payload.sig.slice(2) };
  c.add("participant_registered", 1, bad, "2026-08-01T10:05:00.123Z", null);
  for (let i = 0; i < 3; i++)
    c.add(
      "vote_cast",
      1,
      { issue_id: c.events[1].hash, choice: 0 },
      isoMs(T0 + 600000),
      REG,
    );
  save("poison-pill", c);
}
// drip-feed: ballots of one batch interleaved with real-time (ms ts) public-plane events
{
  const c = new Chain();
  genesis(c, "2026-08-01T00:00:00.000Z");
  const iss = c.add(
    "issue_created",
    1,
    {
      title: "Q",
      choice_count: 2,
      ballot_batch_interval_ms: 60000,
      ballot_batch_min: 3,
    },
    isoMs(T0),
    OP,
  );
  const inst = isoMs(T0 + 60000);
  [
    [0, "10:01:05.101"],
    [1, "10:01:21.456"],
    [1, "10:01:40.002"],
  ].forEach(([ch, t], i) => {
    const p = key(String(40 + i).repeat(32));
    c.add("participant_registered", 1, { pubkey: p.pk }, `2026-08-01T${t}Z`, p);
    c.add("vote_cast", 1, { issue_id: iss.hash, choice: ch }, inst, REG);
  });
  save("drip-feed", c);
}
// marker: 64-choice issue, coerced voter told to pick 41
save(
  "marker-64",
  (() => {
    const c = new Chain();
    genesis(c);
    const iss = c.add(
      "issue_created",
      1,
      {
        title: "Pick a plan",
        choice_count: 64,
        ballot_batch_interval_ms: 60000,
        ballot_batch_min: 3,
      },
      isoMs(T0),
      OP,
    );
    [0, 1, 41].forEach((ch) =>
      c.add(
        "vote_cast",
        1,
        { issue_id: iss.hash, choice: ch },
        isoMs(T0 + 60000),
        REG,
      ),
    );
    return c;
  })(),
);
// last batch of size 1 published, legal
save("lonely-last-batch", election("2026-08-01T00:00:00.000Z", [1, 1, 1, 0]));
console.log("written");
