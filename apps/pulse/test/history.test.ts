import assert from "node:assert/strict";
import { test } from "node:test";
import { historyPage } from "../src/voting/history.js";
import type { HistoryVote } from "../src/voting/store.js";

const AT = new Date("2026-08-09T12:00:00.000Z");
const row = (pollId: string, poll = true): HistoryVote => ({
  pollId,
  castAt: AT,
  ballot: [0],
  ...(poll ? { poll: { question: pollId, choices: ["Yes"] } } : {}),
});

test("a page whose rows' polls were all deleted is empty but keeps its cursor", () => {
  // Two shown rows with no poll, plus the probe row: more remain.
  const page = historyPage([row("b", false), row("a", false), row("x")], 2, AT);
  assert.deepEqual(page.votes, []);
  assert.ok(page.nextCursor, "the next page is still reachable");
  const cursor = JSON.parse(
    Buffer.from(page.nextCursor, "base64url").toString("utf8"),
  ) as { id: string };
  assert.equal(
    cursor.id,
    "a",
    "the cursor follows the last row read, shown or not",
  );
});

test("closesAt and open come from the poll; no cursor on the last page", () => {
  const closes = new Date("2026-08-09T11:00:00.000Z");
  const page = historyPage(
    [
      {
        pollId: "p",
        castAt: AT,
        ballot: [1],
        poll: { question: "Q", choices: ["No"], closesAt: closes },
      },
    ],
    20,
    AT,
  );
  assert.deepEqual(page, {
    votes: [
      {
        pollId: "p",
        question: "Q",
        choices: ["No"],
        ballot: [1],
        castAt: AT.toISOString(),
        closesAt: closes.toISOString(),
        open: false,
      },
    ],
    nextCursor: null,
  });
});
