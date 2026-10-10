// PROPOSED cases, not golden conformance. Uses published deterministic test keys.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newChain,
  REGISTRAR,
} from "../../../tools/fixtures-gen/dist/src/chain.js";
import {
  eventHash,
  signEvent,
} from "../../../tools/fixtures-gen/dist/src/encode.js";
import { serializeExport } from "../../../tools/fixtures-gen/dist/src/serialize.js";

const known = (minute) => ({ kind: "known", minute });
const opaque = (minute, otherIssue = false) => ({
  kind: "opaque",
  minute,
  otherIssue,
});
const full = (minute) => [known(minute), known(minute), known(minute)];
const invalid = (line) => ({ verdict: "INVALID", line });
const partial = (...lines) => ({ verdict: "PARTIAL", lines });
const cases = [
  {
    id: "opaque-member",
    votes: [known(10), known(10), opaque(10), ...full(11)],
    current: invalid(7),
    proposed: partial(6, 7),
  },
  {
    id: "opaque-other-payload",
    votes: [known(10), known(10), opaque(10, true), ...full(11)],
    current: invalid(7),
    proposed: partial(6, 7),
  },
  {
    id: "insufficient-with-one-opaque",
    votes: [known(10), opaque(10), ...full(11)],
    current: invalid(6),
    proposed: invalid(6),
  },
  {
    id: "opaque-closure",
    votes: [...full(10), opaque(11), known(10)],
    current: partial(7),
    proposed: partial(7, 8),
  },
  {
    id: "definite-resumed-instant",
    votes: [...full(10), ...full(11), opaque(10), known(10)],
    current: invalid(11),
    proposed: invalid(11),
  },
  {
    id: "already-full",
    votes: [...full(10), opaque(10), ...full(11)],
    current: partial(7),
    proposed: partial(7),
  },
  {
    id: "known-only-control",
    votes: [known(10), known(10), ...full(11)],
    current: invalid(6),
    proposed: invalid(6),
  },
  {
    id: "known-off-interval",
    votes: [opaque(10), known(10)],
    offInterval: true,
    current: invalid(5),
    proposed: invalid(5),
  },
];

const directory = mkdtempSync(join(tmpdir(), "odc-unknown-batching-"));
const index = [];
for (const spec of cases) {
  const chain = newChain();
  const a = chain.issue("Proposal issue A", 2);
  const b = chain.issue("Proposal issue B", 2);
  for (const vote of spec.votes) {
    if (vote.kind === "known") chain.vote(a.hash, 0, { minutes: vote.minute });
    else
      chain.custom(
        "vote_cast",
        1000000,
        { choice: 0, issue_id: vote.otherIssue ? b.hash : a.hash },
        { minutes: vote.minute, signer: REGISTRAR },
      );
  }
  const events = chain.all.map((event) => ({
    ...event,
    payload: { ...event.payload },
  }));
  if (spec.offInterval) {
    const last = events.at(-1);
    last.ts = last.ts.replace(".000Z", ".001Z");
    last.payload.sig = signEvent(last, REGISTRAR);
    last.hash = eventHash(last);
  }
  const file = spec.id + ".ndjson";
  writeFileSync(join(directory, file), serializeExport(events));
  index.push({
    id: spec.id,
    export: file,
    current: spec.current,
    proposed: spec.proposed,
  });
}
writeFileSync(
  join(directory, "index.json"),
  JSON.stringify(
    { status: "PROPOSED, not conformance", cases: index },
    null,
    2,
  ) + "\n",
);
console.log(directory);
