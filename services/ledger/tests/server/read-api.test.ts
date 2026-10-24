// contracts/read-api.md over real HTTP, one test per rule, plus /head and
// /export. Events are seeded through the writer directly; the write path's
// own HTTP tests live in appends.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeHash,
  verifyExport,
  type Event,
} from "../../src/chain/index.js";
import { Ledger } from "../../src/ledger.js";
import { buildPublicApp } from "../../src/server/public.js";
import { TestChain } from "../chain/support/builders.js";
import { skip, withDb, ZERO_HASH } from "../db/harness.js";
import { getBytes, seed, serving } from "./harness.js";

interface Ctx {
  url: string;
  ledger: Ledger;
  chain: TestChain;
  /** Builds and appends `n` more issues (a genesis first, if none yet). */
  grow: (n: number, title?: (i: number) => string) => Promise<Event[]>;
}

function withPublic(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  return withDb(async ({ app: pool }) => {
    const ledger = await Ledger.open(pool);
    const chain = new TestChain();
    const grow = async (
      n: number,
      title = (i: number) => `Issue ${i}`,
    ): Promise<Event[]> => {
      const built: Event[] = [];
      if (chain.events.length === 0) built.push(chain.add(chain.genesis()));
      for (let i = 0; i < n; i++) {
        built.push(chain.add(chain.issue({ title: title(i) })));
      }
      await seed(ledger, built);
      return built;
    };
    await serving([buildPublicApp({ pool })], ([url]) =>
      fn({ url: url as string, ledger, chain, grow }),
    );
  });
}

interface Page {
  events: Event[];
  next: number | null;
  head: string;
}

async function page(url: string, query = ""): Promise<Page> {
  const res = await fetch(`${url}/events${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as Page;
}

test("RA-1_events_are_returned_in_ascending_seq_order", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(4);
    const { events } = await page(url);
    assert.deepEqual(
      events.map((e) => e.seq),
      [1, 2, 3, 4, 5],
    );
  }),
);

test("RA-2_since_is_exclusive_and_defaults_to_genesis", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(3);
    assert.equal((await page(url)).events[0]?.seq, 1);
    assert.equal((await page(url)).events[0]?.type, "genesis");
    assert.deepEqual(
      (await page(url, "?since=0")).events.map((e) => e.seq),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      (await page(url, "?since=2")).events.map((e) => e.seq),
      [3, 4],
    );
  }),
);

test("RA-3_limit_bounds_the_page_and_zero_is_refused", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(5);
    assert.equal((await page(url, "?limit=2")).events.length, 2);
    assert.equal((await page(url, "?since=1&limit=3")).events[2]?.seq, 4);
    assert.equal((await page(url)).events.length, 6);
    const res = await fetch(`${url}/events?limit=0`);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_limit" });
  }),
);

test("RA-4_response_is_one_json_object_utf8_without_bom", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(1);
    const res = await fetch(`${url}/events`);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes[0], 0x7b); // "{", no BOM
    const body: unknown = JSON.parse(bytes.toString("utf8"));
    assert.ok(typeof body === "object" && body !== null);
    assert.ok(!Array.isArray(body));
  }),
);

test("RA-5_envelope_has_exactly_events_next_head", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    const empty = await page(url);
    assert.deepEqual(empty, { events: [], next: null, head: ZERO_HASH });
    await grow(2);
    const full = await page(url);
    assert.deepEqual(Object.keys(full).sort(), ["events", "head", "next"]);
    assert.equal(full.head, chain.head);
    assert.equal(full.next, null);
    assert.equal((await page(url, "?limit=1")).next, 1);
  }),
);

test("RA-6_pages_are_contiguous_default_1000_and_clamped", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(1001); // 1002 events
    for (const query of ["", "?limit=1000", "?limit=5000"]) {
      const p = await page(url, query);
      assert.equal(p.events.length, 1000, query);
      assert.ok(p.events.every((e, i) => e.seq === i + 1));
      assert.equal(p.next, 1000);
    }
    const rest = await page(url, "?since=1000&limit=9007199254740991");
    assert.deepEqual(
      rest.events.map((e) => e.seq),
      [1001, 1002],
    );
    assert.equal(rest.next, null);
  }),
);

const AWKWARD = ['Quote " and slash \\', "é 日本 🌍", "line sep", "a/b <c>"];

test("RA-7_each_event_is_byte_identical_to_its_export_line", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    await grow(AWKWARD.length, (i) => AWKWARD[i] as string);
    const raw = await getBytes(`${url}/events`);
    const lines = chain.lines().map((l) => Buffer.from(l).toString("utf8"));
    const expected =
      `{"events":[${lines.join(",")}],"next":null,` + `"head":"${chain.head}"}`;
    assert.equal(raw.toString("utf8"), expected);
    // A client verifies a page exactly as an export (RA-7).
    for (const e of (JSON.parse(raw.toString("utf8")) as Page).events) {
      assert.equal(computeHash(e), e.hash);
    }
  }),
);

test("RA-8_head_advances_as_events_are_appended", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    await grow(1);
    const before = (await page(url, "?since=99")).head;
    assert.equal(before, chain.head);
    await grow(1);
    const after = (await page(url, "?since=99")).head;
    assert.equal(after, chain.head);
    assert.notEqual(after, before);
  }),
);

test("RA-9_following_next_walks_the_whole_log", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    await grow(9); // 10 events
    const seen: Event[] = [];
    let since = 0;
    for (;;) {
      const p = await page(url, `?since=${since}&limit=3`);
      seen.push(...p.events);
      if (p.next === null) break;
      since = p.next;
    }
    assert.deepEqual(
      seen.map((e) => [e.seq, e.hash]),
      chain.events.map((e) => [e.seq, e.hash]),
    );
  }),
);

test("RA-10_a_given_since_is_stable_under_append", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(3);
    const first = await page(url, "?since=1&limit=2");
    await grow(5);
    const again = await page(url, "?since=1&limit=2");
    assert.deepEqual(again.events, first.events);
    const resumed = await page(url, "?since=4");
    assert.equal(resumed.events[0]?.seq, 5);
  }),
);

test("RA-11_non_canonical_since_or_limit_is_400_with_no_page", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(2);
    const bad = [
      "",
      "01",
      "+1",
      "-1",
      "1.0",
      "1e3",
      " 1",
      "0x1",
      "abc",
      "9007199254740992",
      "99999999999999999999",
    ];
    for (const [name, code] of [
      ["since", "bad_since"],
      ["limit", "bad_limit"],
    ] as const) {
      for (const v of [...bad, ...(name === "limit" ? ["0"] : [])]) {
        const res = await fetch(
          `${url}/events?${name}=${encodeURIComponent(v)}`,
        );
        assert.equal(res.status, 400, `${name}=${v}`);
        assert.deepEqual(await res.json(), { error: code });
      }
      const repeated = await fetch(`${url}/events?${name}=1&${name}=2`);
      assert.equal(repeated.status, 400);
    }
    // The largest canonical value is accepted.
    const max = await fetch(`${url}/events?since=9007199254740991`);
    assert.equal(max.status, 200);
  }),
);

test("RA-12_since_beyond_head_is_an_empty_200", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    await grow(2);
    for (const since of [3, 4, 1000]) {
      assert.deepEqual(await page(url, `?since=${since}`), {
        events: [],
        next: null,
        head: chain.head,
      });
    }
  }),
);

test("RA-13_events_accepts_no_writes", { skip }, () =>
  withPublic(async ({ url, grow }) => {
    await grow(1);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await fetch(`${url}/events`, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 405, method);
      assert.deepEqual(await res.json(), { error: "method_not_allowed" });
    }
    assert.equal((await page(url)).events.length, 2);
    assert.equal(
      (await fetch(`${url}/appends`, { method: "POST" })).status,
      404,
    );
  }),
);

test("head_reports_the_highest_seq_or_zeros_when_empty", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    const empty = await fetch(`${url}/head`);
    assert.deepEqual(await empty.json(), { seq: 0, hash: ZERO_HASH });
    await grow(2);
    const res = await fetch(`${url}/head`);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await res.json(), { seq: 3, hash: chain.head });
  }),
);

test("export_is_the_stored_lines_byte_for_byte", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    const empty = await fetch(`${url}/export`);
    assert.equal(empty.status, 200);
    assert.equal((await empty.arrayBuffer()).byteLength, 0); // EX-6
    await grow(AWKWARD.length, (i) => AWKWARD[i] as string);
    const res = await fetch(`${url}/export`);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^application\/x-ndjson/,
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.equals(chain.exportBytes()));
    assert.ok(verifyExport(bytes).ok);
  }),
);

test("export_taken_while_appending_is_a_valid_prefix", { skip }, () =>
  withPublic(async ({ url, grow, chain }) => {
    await grow(700); // more than one cursor batch
    const appending = (async () => {
      for (let i = 0; i < 20; i++) await grow(1);
    })();
    const exports = await Promise.all(
      Array.from({ length: 6 }, () => getBytes(`${url}/export`)),
    );
    await appending;
    const final = chain.exportBytes();
    for (const bytes of exports) {
      assert.ok(bytes.length > 0);
      assert.ok(final.subarray(0, bytes.length).equals(bytes));
      assert.ok(verifyExport(bytes).ok);
    }
  }),
);

test(
  "pages_read_during_multi_event_runs_are_contiguous_and_end_on_a_run",
  { skip },
  () =>
    withPublic(async ({ url, grow }) => {
      await grow(4); // genesis + 4: every run boundary is a multiple of 5
      const appending = (async () => {
        for (let i = 0; i < 30; i++) await grow(5);
      })();
      let since = 0;
      let done = false;
      void appending.then(() => (done = true));
      while (!done || since < 155) {
        const p = await page(url, `?since=${since}`);
        p.events.forEach((e, i) => assert.equal(e.seq, since + 1 + i));
        const last = p.events.at(-1);
        if (last !== undefined) {
          assert.equal(
            last.seq % 5,
            0,
            `page ended inside a run at ${last.seq}`,
          );
          since = last.seq;
        }
      }
      await appending;
    }),
);
