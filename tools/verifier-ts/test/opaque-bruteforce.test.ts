// Brute-force differential test for ET-24b / ET-18b (event-types.md v12).
//
// Generates many small random chains — several issues (registered and not,
// at different intervals and minimums), registered ballots, ballots of
// unregistered issues, opaque ballots, varied `ts` — and compares the
// verifier's verdict with a DELIBERATELY NAIVE oracle written here, apart from
// src/: for every registered ballot it recomputes ET-23, ET-24, ET-24a and
// ET-24b's items 1-4 from scratch over all earlier lines, quadratically, in
// the words of the rule. It shares no code with src/batching.ts.
//
// Same caveat as every synthetic suite: the oracle is this author's reading of
// contracts/, so agreement proves the one-pass implementation matches the
// direct definition, not that the definition was read correctly. The ADR-0034
// table in opaque-ballots.test.ts pins the reading itself.
//
// PRNG: sfc32 seeded by splitmix32 — a full-period generator whose low bits
// are as good as its high bits (an LCG's low bit alternates, which once made a
// differential generator here lie about its coverage). The verdict
// distribution is printed and each class is required to occur.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import { tokenAndLine } from "./genesis-builder.js";
import { Chain, UNREG } from "./chain-builder.js";

// --- PRNG ----------------------------------------------------------------------

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function sfc32(seed: number): () => number {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = 1;
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  return () => next() / 4294967296; // [0, 1)
}

// --- the abstract chain ----------------------------------------------------------

type Ev =
  | { k: "issue"; reg: boolean; delta: number; min: number }
  | { k: "vote"; issue: number; ms: number } // a registered (v1) ballot
  | { k: "opaque"; ms: number; names: number } // vote_cast v1000000
  // An unregistered event that is NOT a vote_cast: never a ballot (ET-22a),
  // never a candidate (ET-24b), only a PARTIAL line of its own.
  | {
      k: "other";
      ms: number;
      type: "x_ballot_like" | "participant_registered";
    };

// 2026-07-21T00:00:00.000Z: a day boundary, so a multiple of every interval used.
const BASE = Date.UTC(2026, 6, 21);
const DELTAS = [60000, 120000, 180000];

function generate(rnd: () => number): Ev[] {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rnd() * xs.length)] as T;
  // Per-chain rates, so that some chains carry no opaque ballot or no
  // unregistered issue at all (the only way to reach VALID).
  const opaqueRate = pick([0, 0.12, 0.3]);
  const otherRate = pick([0, 0, 0.08]);
  const unregIssueRate = pick([0, 0, 0.25]);
  // Long chains reach three or more runs of one issue, where w, f and c
  // differ — the ground M5/E/J-style mistakes live on.
  const n = 4 + Math.floor(rnd() * (rnd() < 0.5 ? 13 : 27));
  const evs: Ev[] = [];
  const issues: { delta: number }[] = [];
  const lastMs = new Map<number, number>(); // issue ordinal -> last ballot ms
  const used = new Map<number, number[]>(); // issue ordinal -> instants used
  const instant = (delta: number): number => {
    const ms = BASE + Math.floor(rnd() * 6) * (rnd() < 0.85 ? delta : 60000);
    return rnd() < 0.03 ? ms + 1 : ms; // rare unquantized ts (ET-23)
  };
  const next = (prev: number, delta: number): number =>
    prev - (prev % delta) + delta * (rnd() < 0.8 ? 1 : 2);
  // Where an opaque (or other unregistered) event lands. Besides a random
  // instant and an issue's current one, it may land on an issue's NEXT
  // instant (so it precedes the run there, between c and P(f)) or on an
  // instant the issue has LEFT.
  const unregInstant = (): number => {
    const issue = Math.floor(rnd() * Math.max(1, issues.length));
    const prev = lastMs.get(issue);
    const delta = issues[issue]?.delta ?? 60000;
    const r = rnd();
    if (prev === undefined || r < 0.2) return instant(60000);
    if (r < 0.45) return prev;
    if (r < 0.8) return next(prev, delta);
    return pick(used.get(issue) ?? [prev]);
  };
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (issues.length === 0 ? r < 0.75 : r < 0.06 && issues.length < 3) {
      const delta = pick(DELTAS);
      evs.push({
        k: "issue",
        reg: rnd() >= unregIssueRate,
        delta,
        min: rnd() < 0.75 ? 3 : 4,
      });
      issues.push({ delta });
    } else if (rnd() < otherRate) {
      evs.push({
        k: "other",
        ms: unregInstant(),
        type: rnd() < 0.5 ? "x_ballot_like" : "participant_registered",
      });
    } else if (issues.length > 0 && rnd() >= opaqueRate) {
      const issue = Math.floor(rnd() * issues.length);
      const { delta } = issues[issue] as { delta: number };
      const prev = lastMs.get(issue);
      let ms: number;
      if (prev !== undefined && rnd() < 0.72)
        ms = prev; // stay in the run
      else if (prev !== undefined && rnd() < 0.75)
        ms = next(prev, delta); // move on
      else ms = instant(delta);
      lastMs.set(issue, ms);
      used.set(issue, [...(used.get(issue) ?? []), ms]);
      evs.push({ k: "vote", issue, ms });
    } else {
      evs.push({
        k: "opaque",
        ms: unregInstant(),
        names: Math.floor(rnd() * 4),
      });
    }
  }
  return evs;
}

// --- the naive oracle -------------------------------------------------------------

/** Verdict by direct reading of ET-18, ET-18b, ET-23, ET-24, ET-24a, ET-24b. */
function oracle(evs: Ev[]): string {
  const seqOf = (i: number): number => i + 2; // line 1 is genesis
  const issueAt: number[] = []; // issue ordinal -> index in evs
  const partial: number[] = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i] as Ev;
    if (e.k === "issue") {
      issueAt.push(i);
      if (!e.reg) partial.push(seqOf(i)); // unregistered issue_created
      continue;
    }
    if (e.k === "opaque" || e.k === "other") {
      partial.push(seqOf(i)); // an unregistered (type, version)
      continue;
    }
    const issueIdx = issueAt[e.issue] as number;
    const iss = evs[issueIdx] as Extract<Ev, { k: "issue" }>;
    if (!iss.reg) {
      partial.push(seqOf(i)); // ET-18b: unresolved
      continue;
    }
    const c = seqOf(issueIdx);
    const L = seqOf(i);
    if (e.ms % iss.delta !== 0) return `INVALID at line ${L}`; // ET-23

    // Registered ballots of I strictly before L, in seq order.
    const regs: { seq: number; ms: number }[] = [];
    for (let j = 0; j < i; j++) {
      const x = evs[j] as Ev;
      if (x.k === "vote" && x.issue === e.issue)
        regs.push({ seq: seqOf(j), ms: x.ms });
    }
    // Candidates of I (item 1): opaque, seq > c, ts a multiple of Δ; and
    // seq < seq(L), since every test reads only earlier lines.
    const cands: { seq: number; ms: number }[] = [];
    for (let j = 0; j < i; j++) {
      const x = evs[j] as Ev;
      if (x.k === "opaque" && seqOf(j) > c && x.ms % iss.delta === 0)
        cands.push({ seq: seqOf(j), ms: x.ms });
    }
    const P = regs[regs.length - 1];
    const runStart = P !== undefined && P.ms !== e.ms;

    let unresolved = false;
    if (!runStart) {
      const lo = P === undefined ? c : P.seq;
      unresolved = cands.some((u) => u.seq > lo && u.ms !== e.ms);
    } else {
      // R: the known run ending at P(L); f its first ballot; P(f) before it.
      let fi = regs.length - 1;
      while (fi > 0 && (regs[fi - 1] as { ms: number }).ms === P.ms) fi--;
      const R = regs.length - fi;
      const f = regs[fi] as { seq: number };
      const Pf = fi > 0 ? (regs[fi - 1] as { seq: number }) : undefined;
      const w = Pf === undefined ? c : Pf.seq;
      const t = P.ms;
      // Known failures, over registered ballots alone.
      const known24a = regs.some((r) => r.ms === e.ms);
      const known24 = R < iss.min;
      if (known24a) return `INVALID at line ${L}`; // definite
      if (known24) {
        const F = cands.filter(
          (u) => u.seq > w && u.seq < L && u.ms === t,
        ).length;
        if (R + F < iss.min) return `INVALID at line ${L}`; // definite
        unresolved = true; // item 4(a)
      } else {
        unresolved = cands.some(
          (u) => u.ms === e.ms || (u.seq > f.seq && u.ms !== t),
        );
      }
    }
    if (unresolved) partial.push(L);
  }
  partial.sort((x, y) => x - y);
  return partial.length === 0
    ? "VALID"
    : `PARTIAL at lines ${partial.join(",")}`;
}

// --- build and compare ---------------------------------------------------------

function build(evs: Ev[]): Buffer {
  const c = new Chain();
  const ids: string[] = [];
  for (const e of evs) {
    if (e.k === "issue") {
      ids.push(
        c.issue({
          intervalMs: e.delta,
          min: e.min,
          version: e.reg ? 1 : UNREG,
        }),
      );
    } else if (e.k === "vote") {
      c.vote(ids[e.issue] as string, new Date(e.ms).toISOString());
    } else if (e.k === "other") {
      // Its payload names the first issue, as a ballot's would; still no ballot.
      const named = ids[0] ?? "9".repeat(64);
      c.unregistered(e.type, UNREG, new Date(e.ms).toISOString(), named);
    } else {
      // The opaque payload names an issue (or junk); it must make no difference.
      const named = ids[e.names] ?? "9".repeat(64);
      c.vote(named, new Date(e.ms).toISOString(), UNREG);
    }
  }
  return c.bytes();
}

test("brute force: the one-pass ET-24b/ET-18b implementation agrees with the naive reading", () => {
  const rnd = sfc32(0x0dc24b);
  const cases = 3000;
  const dist = {
    VALID: 0,
    INVALID: 0,
    PARTIAL_opaque_only: 0,
    PARTIAL_with_unresolved: 0,
    INVALID_with_opaque_before: 0,
    with_non_ballot_unregistered: 0,
  };
  for (let n = 0; n < cases; n++) {
    const evs = generate(rnd);
    const want = oracle(evs);
    const got = tokenAndLine(verifyExport(build(evs)));
    assert.equal(got, want, `case ${n}: ${JSON.stringify(evs)}`);

    if (evs.some((e) => e.k === "other")) dist.with_non_ballot_unregistered++;
    if (want === "VALID") dist.VALID++;
    else if (want.startsWith("INVALID")) {
      dist.INVALID++;
      const line = Number(want.slice("INVALID at line ".length));
      if (evs.slice(0, line - 2).some((e) => e.k === "opaque"))
        dist.INVALID_with_opaque_before++;
    } else {
      const lines = want
        .slice("PARTIAL at lines ".length)
        .split(",")
        .map(Number);
      const registeredBallot = lines.some((l) => {
        const e = evs[l - 2] as Ev;
        return e.k === "vote";
      });
      if (registeredBallot) dist.PARTIAL_with_unresolved++;
      else dist.PARTIAL_opaque_only++;
    }
  }
  console.log(
    `opaque-bruteforce verdict distribution over ${cases} chains:`,
    dist,
  );
  for (const [k, v] of Object.entries(dist))
    assert.ok(v >= cases * 0.05, `too few ${k}: ${v} of ${cases}`);
});
