// An in-process HTTP double of the planned signer service (ADR-0043), so the
// real client (src/clients/signer.ts) is exercised over the wire. Paths and
// bodies are the ones API.md (wave 2) documents. TEST KEY ONLY: it signs with REGISTRAR.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Event } from "../../src/chain/canonical.js";
import { REGISTRAR, finish } from "../chain/support/builders.js";

export type Fault =
  | "fail" // 503
  | "timeout" // never answers
  | "malformed" // 200 with a body that is not the documented shape
  | "tamper_sig" // flips a byte of the first sig; hashes and chain stay consistent
  | "tamper_payload" // changes the last event's choice, validly re-signed
  | "http_408" // request timeout status
  | "http_429" // rate limited
  | "bad_request" // 400: the signer found the request malformed
  | "seal_under_min" // seals a non-last batch below ballot_batch_min
  | "seal_extra_count" // seals, answering one count more than choice_count
  | "bare_404"; // 404 with no error code, like a wrong path or a proxy

interface IssueBook {
  choiceCount: number;
  min: number;
  /** Counts per choice for the open batch: no order, no arrival time. */
  counts: number[];
  closed: boolean;
}

interface Batch {
  issueId: string;
  counts: number[];
  /** The one position it was signed at: the request body and the run. */
  signed: { body: string; events: Event[] } | null;
}

export class FakeSigner {
  readonly url: string;
  readonly sealCalls: { issueId: string; sealId: string; last: boolean }[] = [];
  /** Every sign request body received, per batch id. */
  readonly signBodies = new Map<string, string[]>();
  private readonly issues = new Map<string, IssueBook>();
  private readonly seals = new Map<
    string,
    {
      issueId: string;
      last: boolean;
      out: { batch_id: string; counts: number[] };
    }
  >();
  private readonly batches = new Map<string, Batch>();
  private readonly faults: { route: "seal" | "sign"; fault: Fault }[] = [];

  private constructor(
    private readonly server: Server,
    port: number,
  ) {
    this.url = `http://127.0.0.1:${port}`;
  }

  static async start(): Promise<FakeSigner> {
    const box: { fake?: FakeSigner } = {};
    const server = createServer((req, res) => {
      void box.fake?.handle(req).then(
        (out) => {
          if (out === null) return; // "timeout": hold the socket open
          res.writeHead(out.status, { "content-type": "application/json" });
          res.end(out.body);
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    box.fake = new FakeSigner(server, (server.address() as AddressInfo).port);
    return box.fake;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }

  openIssue(issueId: string, choiceCount = 3, min = 3): void {
    this.issues.set(issueId, {
      choiceCount,
      min,
      counts: Array<number>(choiceCount).fill(0),
      closed: false,
    });
  }

  /** Identity's push of an unattributed entry. */
  addEntry(issueId: string, choice: number): "accepted" | "refused" {
    const book = this.issues.get(issueId);
    if (book === undefined || book.closed || choice >= book.choiceCount) {
      return "refused";
    }
    book.counts[choice] = (book.counts[choice] ?? 0) + 1;
    return "accepted";
  }

  /** The next call to `route` misbehaves as `fault`. */
  inject(route: "seal" | "sign", fault: Fault): void {
    this.faults.push({ route, fault });
  }

  private takeFault(route: "seal" | "sign"): Fault | null {
    const i = this.faults.findIndex((f) => f.route === route);
    return i < 0 ? null : (this.faults.splice(i, 1)[0]?.fault ?? null);
  }

  private async handle(
    req: IncomingMessage,
  ): Promise<{ status: number; body: string } | null> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const seal = /^\/issues\/([0-9a-f]{64})\/seals$/.exec(req.url ?? "");
    const sign = /^\/batches\/([A-Za-z0-9_-]+)\/signatures$/.exec(
      req.url ?? "",
    );
    const route = seal ? "seal" : sign ? "sign" : null;
    if (route === null || req.method !== "POST")
      return reply(404, { error: "not_found" });
    const fault = this.takeFault(route);
    if (fault === "fail") return reply(503, { error: "unavailable" });
    if (fault === "timeout") return null;
    if (fault === "malformed") return reply(200, { nope: true });
    if (fault === "http_408") return reply(408, { error: "timeout" });
    if (fault === "bad_request") return reply(400, { error: "bad_request" });
    if (fault === "http_429") return reply(429, { error: "under_min" });
    if (fault === "bare_404") return reply(404, "not here");
    if (seal) return this.seal(seal[1] as string, body, fault);
    return this.sign((sign as RegExpExecArray)[1] as string, raw, body, fault);
  }

  private seal(
    issueId: string,
    body: Record<string, unknown>,
    fault: Fault | null,
  ) {
    const sealId = String(body.seal_id);
    const last = body.last === true;
    this.sealCalls.push({ issueId, sealId, last });
    const done = this.seals.get(sealId);
    if (done !== undefined) {
      // Idempotent by seal id, but only for the same question.
      if (done.issueId !== issueId || done.last !== last) {
        return reply(409, { error: "seal_conflict" });
      }
      return reply(200, done.out);
    }
    const book = this.issues.get(issueId);
    if (book === undefined) return reply(404, { error: "unknown_issue" });
    if (book.closed) return reply(409, { error: "issue_closed" });
    const total = book.counts.reduce((a, b) => a + b, 0);
    if (!last && total < book.min && fault !== "seal_under_min") {
      return reply(409, { error: "under_min" });
    }
    const out = {
      batch_id: randomBytes(8).toString("hex"),
      counts: fault === "seal_extra_count" ? [...book.counts, 0] : book.counts,
    };
    this.batches.set(out.batch_id, {
      issueId,
      counts: book.counts,
      signed: null,
    });
    this.seals.set(sealId, { issueId, last, out });
    book.counts = Array<number>(book.choiceCount).fill(0);
    if (last) book.closed = true;
    return reply(200, out);
  }

  private sign(
    batchId: string,
    raw: string,
    body: Record<string, unknown>,
    fault: Fault | null,
  ) {
    this.signBodies.set(batchId, [
      ...(this.signBodies.get(batchId) ?? []),
      raw,
    ]);
    const batch = this.batches.get(batchId);
    if (batch === undefined) return reply(404, { error: "unknown_batch" });
    let events: Event[];
    if (batch.signed !== null) {
      // One position only: identical inputs give the identical run.
      if (batch.signed.body !== raw)
        return reply(409, { error: "position_taken" });
      events = batch.signed.events;
    } else {
      if (
        body.issue_id !== batch.issueId ||
        !Number.isSafeInteger(body.first_seq) ||
        typeof body.ts !== "string" ||
        typeof body.first_prev_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(body.first_prev_hash) ||
        !Array.isArray(body.payloads)
      ) {
        return reply(400, { error: "bad_request" });
      }
      const payloads = body.payloads as { issue_id: string; choice: number }[];
      const counts = Array<number>(batch.counts.length).fill(0);
      for (const p of payloads) {
        if (p.issue_id !== batch.issueId || Object.keys(p).length !== 2) {
          return reply(409, { error: "payload_mismatch" });
        }
        counts[p.choice] = (counts[p.choice] ?? 0) + 1;
      }
      // An empty run is refused too. ADR-0043 does not say; the ledger never
      // asks, since an empty last batch has nothing to append.
      if (counts.join() !== batch.counts.join() || payloads.length === 0) {
        return reply(409, { error: "counts_mismatch" });
      }
      events = signRun(
        payloads,
        Number(body.first_seq),
        String(body.ts),
        String(body.first_prev_hash),
      );
      batch.signed = { body: raw, events };
    }
    if (fault === "tamper_sig") {
      const [first, ...rest] = events as [Event, ...Event[]];
      const sig = String(first.payload.sig);
      const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
      const { seq, type, version, ts, prev_hash, payload } = first;
      const base = { seq, type, version, ts, prev_hash, payload };
      const bad = finish(base, null, flipped);
      const payloads = rest.map((e) => ({
        issue_id: batch.issueId,
        choice: Number(e.payload.choice),
      }));
      events = [bad, ...signRun(payloads, bad.seq + 1, bad.ts, bad.hash)];
    }
    if (fault === "tamper_payload") {
      const last = events.at(-1) as Event;
      const choice = (Number(last.payload.choice) + 1) % 2;
      const changed = signRun(
        [{ issue_id: batch.issueId, choice }],
        last.seq,
        last.ts,
        last.prev_hash,
      );
      events = [...events.slice(0, -1), ...changed];
    }
    return reply(200, { events });
  }
}

function reply(status: number, body: unknown) {
  return Promise.resolve({ status, body: JSON.stringify(body) });
}

/** Positions, chains and signs a run (deterministic RFC 8032, REGISTRAR). */
function signRun(
  payloads: { issue_id: string; choice: number }[],
  firstSeq: number,
  ts: string,
  firstPrevHash: string,
): Event[] {
  const out: Event[] = [];
  payloads.forEach((p, i) => {
    out.push(
      finish(
        {
          seq: firstSeq + i,
          type: "vote_cast",
          version: 1,
          payload: { issue_id: p.issue_id, choice: p.choice },
          ts,
          prev_hash: out.at(-1)?.hash ?? firstPrevHash,
        },
        REGISTRAR,
      ),
    );
  });
  return out;
}
