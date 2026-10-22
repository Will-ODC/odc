// Loads contracts/fixtures as raw bytes (fixtures/README.md: never as text).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Vector {
  readonly id: string;
  readonly export: string;
  readonly head?: string;
  readonly chain?: string;
  readonly expect:
    | { readonly verdict: "VALID" }
    | { readonly verdict: "INVALID"; readonly line: number }
    | { readonly verdict: "PARTIAL"; readonly lines: readonly number[] };
}

function findFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "contracts", "fixtures");
    if (existsSync(join(candidate, "index.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("contracts/fixtures not found");
    dir = parent;
  }
}

export const FIXTURES_DIR = findFixturesDir();

export function fixtureBytes(relative: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, relative));
}

export function loadVectors(): Vector[] {
  const index = JSON.parse(fixtureBytes("index.json").toString("utf8")) as {
    vectors: Vector[];
  };
  return index.vectors;
}

export function vectorBytes(v: Vector): Buffer {
  return fixtureBytes(v.export);
}

/** The LF-terminated lines of an export known to be well framed. */
export function vectorLines(v: Vector): Buffer[] {
  const bytes = vectorBytes(v);
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lines.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  return lines;
}
