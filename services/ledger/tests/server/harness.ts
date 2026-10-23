import type { FastifyInstance } from "fastify";
import type { Event, UnhashedEvent } from "../../src/chain/index.js";
import type { Ledger } from "../../src/ledger.js";

/** Listens on an ephemeral loopback port and returns its base URL. */
export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return `http://127.0.0.1:${addr.port}`;
}

/** Runs `fn` with each app listening, and closes them all afterwards. */
export async function serving(
  apps: FastifyInstance[],
  fn: (urls: string[]) => Promise<void>,
): Promise<void> {
  try {
    const urls: string[] = [];
    for (const app of apps) urls.push(await listen(app));
    await fn(urls);
  } finally {
    await Promise.allSettled(apps.map((a) => a.close()));
  }
}

/** The six content fields: what a submitter sends (no `hash`). */
export function unhashed(e: Event): UnhashedEvent {
  return {
    seq: e.seq,
    type: e.type,
    version: e.version,
    payload: e.payload,
    ts: e.ts,
    prev_hash: e.prev_hash,
  };
}

/** Appends already-built events directly, bypassing HTTP. */
export async function seed(ledger: Ledger, events: Event[]): Promise<void> {
  await ledger.appendRun(() => events.map(unhashed));
}

export async function getBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
