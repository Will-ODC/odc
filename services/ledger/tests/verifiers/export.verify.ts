// Black-box agreement: chains built through the HTTP write path and through
// the batcher (ballot batches), judged by both independent verifiers as CLIs. Neither
// verifier's source is read; only their exit code and first output line.
//
// Run with `pnpm --filter @odc/ledger test:verifiers` and:
//   ODC_VERIFY_GO  path to the built Go verifier
//   ODC_VERIFY_TS  the TS verifier command, e.g.
//                  "node <repo>/tools/verifier-ts/dist/src/cli.js verify"
// Not part of `pnpm test`: CI runs it in its own step with both set, and
// with LEDGER_REQUIRE_DATABASE=1 a missing verifier is a failure, not a skip.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyExport } from "../../src/chain/index.js";
import { databaseRequired } from "../../src/db/config.js";
import { exportLines } from "../../src/db/events.js";
import { fill, world } from "../batching/setup.js";
import { skip as dbSkip, withDb } from "../db/harness.js";
import { getBytes } from "../server/harness.js";
import { flipByte, randomChain, rng } from "../server/random.js";
import { withServers } from "../server/write-harness.js";

function command(name: string): string[] | undefined {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw.split(/\s+/);
}

const verifiers = {
  go: command("ODC_VERIFY_GO"),
  ts: command("ODC_VERIFY_TS"),
};
const missing = verifiers.go === undefined || verifiers.ts === undefined;
const skip =
  dbSkip !== false
    ? dbSkip
    : missing && !databaseRequired()
      ? "ODC_VERIFY_GO and ODC_VERIFY_TS are unset"
      : false;

interface Verdict {
  exit: number;
  verdict: string;
  line: number | null;
  first: string;
}

function run(cmd: string[], file: string): Promise<Verdict> {
  const [bin, ...args] = cmd as [string, ...string[]];
  return new Promise((resolve) => {
    execFile(bin, [...args, file], (err, stdout) => {
      const first = stdout.split("\n")[0] ?? "";
      const m = /^(VALID|INVALID|PARTIAL)(?: at line (\d+))?/.exec(first);
      const exit =
        err === null ? 0 : typeof err.code === "number" ? err.code : -1;
      resolve({
        exit,
        verdict: m?.[1] ?? "",
        line: m?.[2] === undefined ? null : Number(m[2]),
        first,
      });
    });
  });
}

async function judge(dir: string, name: string, bytes: Buffer) {
  const file = join(dir, name);
  await writeFile(file, bytes);
  return {
    go: await run(verifiers.go as string[], file),
    ts: await run(verifiers.ts as string[], file),
  };
}

test("both_verifiers_agree_with_the_ledger_on_its_export", { skip }, () => {
  assert.ok(
    !missing,
    "LEDGER_REQUIRE_DATABASE=1 needs ODC_VERIFY_GO and ODC_VERIFY_TS",
  );
  return withServers(async ({ pub, submit }) => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-verify-"));
    try {
      const r = rng(7);
      await randomChain(submit, r, 8);
      const exported = await getBytes(`${pub}/export`);
      assert.ok(verifyExport(exported).ok);
      const clean = await judge(dir, "clean.ndjson", exported);
      for (const [who, v] of Object.entries(clean)) {
        console.log(`${who} clean: exit ${v.exit}: ${v.first}`);
        assert.equal(v.exit, 0, `${who}: ${v.first}`);
        assert.equal(v.verdict, "VALID", who);
      }
      for (let k = 0; k < 12; k++) {
        const { tampered, line } = flipByte(exported, r);
        const own = verifyExport(tampered);
        assert.ok(!own.ok);
        assert.equal(own.line, line);
        const res = await judge(dir, `flip-${k}.ndjson`, tampered);
        for (const [who, v] of Object.entries(res)) {
          console.log(`${who} flip ${k}: exit ${v.exit}: ${v.first}`);
          assert.equal(v.exit, 1, `${who} flip ${k}: ${v.first}`);
          assert.equal(v.verdict, "INVALID", who);
          assert.equal(v.line, own.line, `${who} flip ${k}: ${v.first}`);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function exportOf(pool: Parameters<typeof exportLines>[0]) {
  let text = "";
  for await (const line of exportLines(pool)) text += line;
  return Buffer.from(text, "utf8");
}

test(
  "both_verifiers_accept_ballot_batches_and_agree_on_tampering",
  { skip },
  () => {
    assert.ok(
      !missing,
      "LEDGER_REQUIRE_DATABASE=1 needs ODC_VERIFY_GO and ODC_VERIFY_TS",
    );
    return withDb(async ({ app }) =>
      world(app, [{}, { choice_count: 2, ballot_batch_min: 4 }], async (w) => {
        const [a, b] = w.issueIds as [string, string];
        const batcher = w.batcher();
        // Interleaved full batches across three instants, then an under-size
        // last batch for each issue via close (ET-24 allows it only last).
        for (let round = 0; round < 3; round++) {
          fill(w.fake, a, [0, 1, 2, round % 3]);
          fill(w.fake, b, [0, 1, 1, 0, round % 2]);
          assert.equal(await batcher.tick(), true);
          w.clock.now += 60000;
        }
        fill(w.fake, a, [2]);
        fill(w.fake, b, [1, 0]);
        for (const id of [a, b]) {
          assert.equal(await batcher.closeIssue(id), "closed");
        }
        const exported = await exportOf(app);
        assert.ok(verifyExport(exported).ok);
        const dir = await mkdtemp(join(tmpdir(), "ledger-verify-"));
        try {
          const clean = await judge(dir, "batches.ndjson", exported);
          for (const [who, v] of Object.entries(clean)) {
            console.log(`${who} batches: exit ${v.exit}: ${v.first}`);
            assert.equal(v.exit, 0, `${who}: ${v.first}`);
            assert.equal(v.verdict, "VALID", who);
          }
          const r = rng(11);
          for (let k = 0; k < 8; k++) {
            const { tampered } = flipByte(exported, r);
            const own = verifyExport(tampered);
            assert.ok(!own.ok);
            const res = await judge(dir, `bflip-${k}.ndjson`, tampered);
            for (const [who, v] of Object.entries(res)) {
              console.log(`${who} bflip ${k}: exit ${v.exit}: ${v.first}`);
              assert.equal(v.exit, 1, `${who} bflip ${k}: ${v.first}`);
              assert.equal(v.verdict, "INVALID", `${who}: ${v.first}`);
              assert.equal(v.line, own.line, `${who} bflip ${k}: ${v.first}`);
            }
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }),
    );
  },
);
