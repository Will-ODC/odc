import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { createServer } from "../src/http/server.js";
import { SessionSigner } from "../src/http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

const AT = new Date("2026-10-20T12:00:00.000Z");
interface Page {
  polls: {
    id: string;
    question: string;
    method: string;
    createdAt: string;
    closesAt: string | null;
    open: boolean;
  }[];
  nextCursor: string | null;
}

for (const kind of ["memory", "postgres"] as const) {
  test(
    `${kind}: public listing paginates communities over real HTTP`,
    { skip: kind === "postgres" ? databaseSkip : false },
    async (t) => {
      let now = AT;
      const clock = () => now;
      const pool: Pool | undefined =
        kind === "postgres" ? await migratedSchema(t) : undefined;
      const votes = pool
        ? new PostgresVotingStore(pool, clock)
        : new InMemoryVotingStore(clock);
      if (pool)
        await pool.query(
          "insert into community values ('campus', 'Campus'), ('other', 'Other')",
        );
      async function seed(
        id: string,
        community: string | null = "campus",
        closed = false,
      ) {
        const input = {
          id,
          question: `Question ${id}`,
          choices: ["Yes", "No"],
          method: "single" as const,
          ...(closed ? { closesAt: AT } : {}),
        };
        if (votes instanceof InMemoryVotingStore) {
          await votes.createPoll(
            input,
            community === null
              ? undefined
              : {
                  community: { id: community, label: community },
                  attribution: { kind: "anonymous" },
                },
          );
        } else {
          await votes.createPoll(input);
          await pool!.query("update polls set community = $1 where id = $2", [
            community,
            id,
          ]);
        }
      }
      // Deliberately not insertion order, including a UTF-8 vs UTF-16 tie.
      for (const id of ["a", "z", "\u{10000}", "\ue000"])
        await seed(id, "campus", id === "z");
      await seed("elsewhere", "other");
      await seed("legacy", null);
      if (pool) {
        await seed("hidden");
        await pool.query("update polls set hidden = true where id = 'hidden'");
      }
      const voters = new InMemoryVoterStore();
      const claims = new ClaimService(
        {
          membership: new DomainAllowlist(new StaticDomainSource([])),
          voters,
          claims: new InMemoryClaimStore(),
          mailer: new ConsoleMailer(() => {}),
          linkFor: () => "https://pulse.test/sign-in",
        },
        { clock },
      );
      const app = await createServer({
        votes,
        voters,
        claims,
        clock,
        suggestions: new InMemorySuggestionStore({ clock }),
        signer: new SessionSigner("listing-test-secret-long-enough", { clock }),
      });
      t.after(() => app.close());
      const origin = await app.listen({ port: 0, host: "127.0.0.1" });
      async function get(query: string) {
        const response = await fetch(`${origin}/api/polls?${query}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("set-cookie"), null);
        return (await response.json()) as Page;
      }
      const first = await get("community=campus&limit=2");
      assert.deepEqual(
        first.polls.map((p) => p.id),
        ["\u{10000}", "\ue000"],
      );
      assert.ok(first.nextCursor);
      assert.deepEqual(Object.keys(first.polls[0]!).sort(), [
        "closesAt",
        "createdAt",
        "id",
        "method",
        "open",
        "question",
      ]);
      assert.equal(first.polls[0]!.createdAt, AT.toISOString());
      // A newer insertion must not move the page boundary and repeat a row.
      now = new Date(AT.getTime() + 1000);
      await seed("new");
      const second = await get(
        `community=campus&limit=2&cursor=${first.nextCursor}`,
      );
      assert.deepEqual(
        second.polls.map((p) => p.id),
        ["z", "a"],
      );
      assert.equal(second.polls[0]!.open, false);
      assert.equal(second.polls[0]!.closesAt, AT.toISOString());
      assert.equal(second.nextCursor, null);
      assert.equal((await get("community=campus")).polls[0]!.id, "new");
      assert.deepEqual(
        (await get("community=other")).polls.map((p) => p.id),
        ["elsewhere"],
      );
      assert.deepEqual(await get("community=missing"), {
        polls: [],
        nextCursor: null,
      });
      for (const query of [
        "",
        "community=",
        "community=campus&limit=0",
        "community=campus&limit=101",
        "community=campus&limit=1.5",
        "community=campus&limit=2x",
        "community=campus&limit=01",
        "community=campus&cursor=broken",
        "community=campus&cursor=",
        "community=campus&community=other",
        "community=campus&surprise=1",
        `community=other&cursor=${first.nextCursor}`,
        `community=${"a".repeat(201)}`,
        `community=campus&cursor=${"a".repeat(2049)}`,
      ]) {
        const response = await fetch(`${origin}/api/polls?${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(
          ((await response.json()) as { error: string }).error,
          "bad_request",
        );
      }
      assert.equal(
        (await votes.results("a")).voters,
        0,
        "browsing must not cast",
      );
      // A cursor is an ordering boundary, not a foreign key to a live row.
      if (pool) {
        await pool.query("delete from polls where id = $1", ["\ue000"]);
        await pool.query("update polls set hidden = true where id = 'a'");
        assert.deepEqual(
          (await get(`community=campus&cursor=${first.nextCursor}`)).polls.map(
            (p) => p.id,
          ),
          ["z"],
        );
      }
      votes.listPolls = async () => {
        throw new Error("private storage details");
      };
      const failed = await fetch(`${origin}/api/polls?community=campus`);
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), {
        error: "server_error",
        message: "Something went wrong. Try again.",
      });
    },
  );
}
