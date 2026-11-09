import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Ledger } from "../../src/ledger.js";
import { buildInternalApp } from "../../src/server/internal.js";
import { buildPublicApp } from "../../src/server/public.js";
import type { ServerLogger } from "../../src/server/http.js";
import { TestChain } from "../chain/support/builders.js";
import { serving, unhashed } from "./harness.js";

/**
 * API.md, "All error bodies": on either port an unknown path is 404, a body
 * over the port's limit 413, a body neither JSON nor plain text 415, and a
 * server fault a bare `500 internal`. No database: the 500 comes from a pool
 * or ledger that fails the way a broken dependency would.
 */

/** Words a fault carries that must never reach a client. */
const SECRET = "secret-db-host password=hunter2";
/** A marker in a request body: request bodies are never logged. */
const BODY_MARKER = "body-marker-7f3a";

const PUBLIC_LIMIT = 1024;
const INTERNAL_LIMIT = 2 * 65_536;

function failingPool(): Pool {
  const fail = () => Promise.reject(new Error(SECRET));
  return { query: fail, connect: fail } as unknown as Pool;
}

function failingLedger(): Ledger {
  return {
    state: { genesis: null, issues: new Map() },
    notValid: null,
    appendRun: () => Promise.reject(new Error(SECRET)),
  } as unknown as Ledger;
}

/** A JSON object body of exactly `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  const frame = '{"x":""}'.length;
  return `{"x":"${"a".repeat(bytes - frame)}"}`;
}

function capture(): { logger: ServerLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: { level: "info", stream: { write: (l: string) => lines.push(l) } },
  };
}

interface Case {
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly contentType?: string;
  readonly body?: string;
  readonly status: number;
  readonly error: string;
}

interface Port {
  readonly name: string;
  readonly build: (logger: ServerLogger) => FastifyInstance;
  readonly cases: readonly Case[];
}

const genesis = new TestChain().genesis();
const validAppend = JSON.stringify({
  event: {
    ...unhashed(genesis),
    payload: { ...genesis.payload, note: BODY_MARKER },
  },
});

const ports: readonly Port[] = [
  {
    name: "public",
    build: (logger) => buildPublicApp({ pool: failingPool(), logger }),
    cases: [
      {
        name: "an_unknown_path_is_404_not_found",
        method: "GET",
        path: "/missing",
        status: 404,
        error: "not_found",
      },
      {
        name: "a_body_one_byte_over_1024_is_413_payload_too_large",
        method: "POST",
        path: "/events",
        contentType: "text/plain",
        body: "x".repeat(PUBLIC_LIMIT + 1),
        status: 413,
        error: "payload_too_large",
      },
      {
        name: "a_body_of_exactly_1024_bytes_passes_the_limit",
        method: "POST",
        path: "/events",
        contentType: "text/plain",
        body: "x".repeat(PUBLIC_LIMIT),
        status: 405,
        error: "method_not_allowed",
      },
      {
        name: "an_xml_body_is_415_unsupported_media_type",
        method: "POST",
        path: "/events",
        contentType: "application/xml",
        body: "<request/>",
        status: 415,
        error: "unsupported_media_type",
      },
      {
        name: "a_storage_fault_is_a_bare_500_internal",
        method: "GET",
        path: "/head",
        status: 500,
        error: "internal",
      },
    ],
  },
  {
    name: "internal",
    build: (logger) => buildInternalApp({ ledger: failingLedger(), logger }),
    cases: [
      {
        name: "an_unknown_path_is_404_not_found",
        method: "GET",
        path: "/missing",
        status: 404,
        error: "not_found",
      },
      {
        name: "a_body_one_byte_over_131072_is_413_payload_too_large",
        method: "POST",
        path: "/appends",
        contentType: "application/json",
        body: jsonOfSize(INTERNAL_LIMIT + 1),
        status: 413,
        error: "payload_too_large",
      },
      {
        name: "a_body_of_exactly_131072_bytes_passes_the_limit",
        method: "POST",
        path: "/appends",
        contentType: "application/json",
        body: jsonOfSize(INTERNAL_LIMIT),
        status: 400,
        error: "bad_request",
      },
      {
        name: "an_xml_body_is_415_unsupported_media_type",
        method: "POST",
        path: "/appends",
        contentType: "application/xml",
        body: "<event/>",
        status: 415,
        error: "unsupported_media_type",
      },
      {
        name: "a_ledger_fault_is_a_bare_500_internal",
        method: "POST",
        path: "/appends",
        contentType: "application/json",
        body: validAppend,
        status: 500,
        error: "internal",
      },
    ],
  },
];

for (const port of ports) {
  for (const c of port.cases) {
    test(`${port.name}_port_${c.name}`, async () => {
      const { logger, lines } = capture();
      await serving([port.build(logger)], async ([base]) => {
        const res = await fetch(`${base}${c.path}`, {
          method: c.method,
          ...(c.contentType === undefined
            ? {}
            : { headers: { "content-type": c.contentType } }),
          ...(c.body === undefined ? {} : { body: c.body }),
        });
        const raw = await res.text();
        assert.equal(res.status, c.status, raw);
        assert.match(
          res.headers.get("content-type") ?? "",
          /^application\/json/,
        );
        // Exactly the documented body: no message, stack or other field.
        assert.deepEqual(JSON.parse(raw), { error: c.error });
        if (c.status === 500) {
          assert.equal(raw, '{"error":"internal"}');
          // The operator log carries the fault (and may contain SECRET), so
          // only the response is checked for it.
          assert.doesNotMatch(raw, new RegExp(SECRET));
          const log = lines.join("");
          assert.match(log, /request failed/);
          // Only the internal 500 has a request body; the public case is GET.
          if (port.name === "internal") {
            assert.doesNotMatch(log, new RegExp(BODY_MARKER));
          }
        }
      });
    });
  }
}
