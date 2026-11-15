// The built entry point (dist/src/main.js) as a child process: production's
// own assembly, config, ports and signal handling, not a test composition
// (#631). Migrated throwaway DB, the signer double, real env vars.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ledger } from "../../src/ledger.js";
import { TestChain } from "../chain/support/builders.js";
import { skip, withDb } from "../db/harness.js";
import { FakeSigner } from "../support/fake-signer.js";
import { seed } from "./harness.js";

const MAIN = fileURLToPath(new URL("../../src/main.js", import.meta.url));
const LISTENING = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/;

/** Both listening URLs, in listen order (public, then internal). */
function listening(child: ChildProcess, ms: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const urls: string[] = [];
    let out = "";
    const timer = setTimeout(
      () => reject(new Error(`no listen within ${ms} ms:\n${out}`)),
      ms,
    );
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code} before listening:\n${out}`));
    };
    child.once("exit", onExit);
    const onData = (chunk: Buffer) => {
      out += String(chunk);
      for (const line of String(chunk).split("\n")) {
        const m = LISTENING.exec(line);
        if (m) urls.push(m[1] as string);
      }
      if (urls.length === 2) {
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(urls);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (c: Buffer) => (out += String(c)));
  });
}

test(
  "the_built_entry_point_serves_the_stored_head_and_exits_cleanly_on_sigterm",
  { skip, timeout: 30_000 },
  () =>
    withDb(async (db) => {
      // A VALID stored log, so main takes the batcher path (recover, start).
      const chain = new TestChain();
      const events = [chain.add(chain.genesis()), chain.add(chain.issue())];
      await seed(await Ledger.open(db.app), events);
      const last = events.at(-1);

      const fake = await FakeSigner.start();
      const child = spawn(process.execPath, [MAIN], {
        env: {
          ...process.env,
          LEDGER_DATABASE_URL: db.app.options.connectionString,
          LEDGER_SIGNER_URL: fake.url,
          LEDGER_PUBLIC_HOST: "127.0.0.1",
          LEDGER_PUBLIC_PORT: "0",
          LEDGER_INTERNAL_HOST: "127.0.0.1",
          LEDGER_INTERNAL_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (c: Buffer) => (stderr += String(c)));
      const exited = once(child, "exit") as Promise<
        [number | null, NodeJS.Signals | null]
      >;
      try {
        const [pub] = await listening(child, 15_000);
        const res = await fetch(`${pub as string}/head`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), {
          seq: last?.seq,
          hash: last?.hash,
        });
        assert.doesNotMatch(stderr, /appends are refused/);

        // SIGTERM closes both ports, the batcher's timer and the pool; the
        // process then exits on its own, with no handle left open.
        child.kill("SIGTERM");
        const deadline = new Promise<"hung">((r) =>
          setTimeout(() => r("hung"), 10_000).unref(),
        );
        const result = await Promise.race([exited, deadline]);
        assert.notEqual(result, "hung", `still running after SIGTERM`);
        assert.deepEqual(result, [0, null], stderr);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
        await fake.close();
      }
    }),
);
