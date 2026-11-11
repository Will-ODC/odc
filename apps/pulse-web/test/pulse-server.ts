import { vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import type { Ballot, Poll } from "../src/api/types.js";
import { results } from "./stub-api.js";

/** Results for one voter who picked `ballot`. */
export function tally(p: Poll, ballot: Ballot) {
  return results({
    pollId: p.id,
    question: p.question,
    method: p.method,
    voters: 1,
    choices: p.choices.map((label, index) => ({
      index,
      label,
      count: ballot.includes(index) ? 1 : 0,
      share: ballot.includes(index) ? 100 : 0,
    })),
  });
}

/**
 * A pulse server behind a fetch, for the real http client: the ballot it
 * holds, a lost connection on the send the test marks, and, once the test
 * says so, no connection at all. Browsers reject a fetch that gets no reply
 * with a TypeError, not an Error.
 */
export function pulseServer(p: Poll) {
  let held: Ballot | null = null;
  let dropNext = false;
  let offline = false;
  const asked: string[] = [];
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const doFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      asked.push(`${method} ${url}`);
      if (offline) throw new TypeError("Failed to fetch");
      const at = `/api/polls/${p.id}`;
      if (method === "GET" && url === "/api/me")
        return reply({ error: "signed_out", message: "Sign in." }, 401);
      if (method === "GET" && url === "/api/my-votes")
        return reply({ votes: [], nextCursor: null });
      if (method === "GET" && url === at) return reply(p);
      if (method === "GET" && url === `${at}/ballot`)
        return reply({ ballot: held });
      if (method === "GET" && url === `${at}/results`)
        return reply(tally(p, held ?? []));
      if (method === "POST" && url === `${at}/votes`) {
        const { ballot } = JSON.parse(String(init?.body)) as {
          ballot: Ballot;
        };
        const status = held ? "changed" : "counted";
        held = ballot;
        // Stored, but the reply never arrives.
        if (dropNext) {
          dropNext = false;
          throw new TypeError("Failed to fetch");
        }
        return reply({ status, ballot, results: tally(p, ballot) });
      }
      throw new Error(`the server does not answer ${method} ${url}`);
    },
  );
  return {
    api: new HttpPulseApi("/api", doFetch as typeof fetch),
    asked,
    dropNextSend: () => (dropNext = true),
    setOffline: (down: boolean) => (offline = down),
  };
}
