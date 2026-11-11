import { describe, expect, it } from "vitest";
import type { MyVote } from "../src/api/types.js";
import {
  answeredList,
  mergedVotes,
  myVotesPlace,
} from "../src/flow/answered.js";
import { poll } from "./stub-api.js";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

function saved(over: Partial<MyVote> = {}): MyVote {
  return {
    pollId: "parks",
    question: "More parks?",
    choices: ["Yes"],
    ballot: [1],
    castAt: "2026-11-01T00:00:00.000Z",
    closesAt: null,
    open: true,
    ...over,
  };
}

describe("answeredList (#484)", () => {
  it("is the server's list when nothing was answered on this page", () => {
    const list = [saved(), saved({ pollId: "fixes", question: "Fixes?" })];
    expect(answeredList(list, [], [], NOW)).toEqual(list);
  });

  it("puts a new answer on top, newest first, with its labels", () => {
    const first = poll({ id: "a", question: "A?" });
    const second = poll({ id: "b", question: "B?" });
    const list = answeredList(
      [saved()],
      [
        { poll: first, ballot: [0] },
        { poll: second, ballot: [1] },
      ],
      ["a", "b"],
      NOW,
    );
    expect(list.map((vote) => vote.pollId)).toEqual(["b", "a", "parks"]);
    expect(list[0]).toEqual({
      pollId: "b",
      question: "B?",
      choices: ["Yes"],
      ballot: [1],
      castAt: "2026-11-07T12:00:00.000Z",
      closesAt: null,
      open: true,
    });
  });

  it("moves a changed answer to the top, as the server does", () => {
    const server = [saved({ pollId: "fixes" }), saved()];
    const parks = poll({ id: "parks", question: "More parks?" });
    const list = answeredList(
      server,
      [{ poll: parks, ballot: [0] }],
      ["parks"],
      NOW,
    );
    expect(list.map((vote) => [vote.pollId, vote.choices])).toEqual([
      ["parks", ["No"]],
      ["fixes", ["Yes"]],
    ]);
  });

  it("moves an earlier local answer to the top when it changes", () => {
    const a = poll({ id: "a", question: "A?" });
    const b = poll({ id: "b", question: "B?" });
    const list = answeredList(
      [],
      [
        { poll: a, ballot: [1] },
        { poll: b, ballot: [1] },
      ],
      ["a", "b", "a"],
      NOW,
    );
    expect(list.map((vote) => vote.pollId)).toEqual(["a", "b"]);
  });

  it("keeps a restored answer in the server's place", () => {
    const server = [saved({ pollId: "fixes" }), saved()];
    const parks = poll({ id: "parks", question: "More parks?" });
    expect(
      answeredList(server, [{ poll: parks, ballot: [1] }], [], NOW),
    ).toEqual(server);
  });

  it("uses a restored local answer in the older server row's place", () => {
    const server = [saved({ pollId: "fixes" }), saved()];
    const parks = poll({ id: "parks", question: "More parks?" });
    const list = answeredList(server, [{ poll: parks, ballot: [0] }], [], NOW);
    expect(list.map((vote) => [vote.pollId, vote.choices])).toEqual([
      ["fixes", ["Yes"]],
      ["parks", ["No"]],
    ]);
  });

  it("appends a restored answer that is absent from the loaded server page", () => {
    const server = [saved({ pollId: "fixes", question: "Fixes?" })];
    const parks = poll({ id: "parks", question: "More parks?" });
    const list = answeredList(server, [{ poll: parks, ballot: [1] }], [], NOW);
    expect(list.map((vote) => vote.pollId)).toEqual(["fixes", "parks"]);
  });

  it("keeps a changed-then-changed-back answer on top", () => {
    const server = [saved({ pollId: "fixes" }), saved()];
    const parks = poll({ id: "parks", question: "More parks?" });
    const list = answeredList(
      server,
      [{ poll: parks, ballot: [1] }],
      ["parks"],
      NOW,
    );
    expect(list.map((vote) => vote.pollId)).toEqual(["parks", "fixes"]);
  });

  it("orders an approval ballot and says when the question has closed", () => {
    const fixes = poll({
      id: "fixes",
      choices: ["Park", "Library", "Rink"],
      method: "approval",
      closesAt: "2026-11-07T11:00:00.000Z",
    });
    const [vote] = answeredList(
      [],
      [{ poll: fixes, ballot: [2, 0] }],
      ["fixes"],
      NOW,
    );
    expect(vote!.ballot).toEqual([0, 2]);
    expect(vote!.choices).toEqual(["Park", "Rink"]);
    expect(vote!.open).toBe(false);
  });
});

describe("myVotesPlace (#528)", () => {
  const rows = [
    saved({ pollId: "first" }),
    saved({ pollId: "middle" }),
    saved({ pollId: "last" }),
  ];
  const at = (
    current: string,
    over: Partial<Parameters<typeof myVotesPlace>[0]> = {},
  ) =>
    myVotesPlace({
      ordered: rows,
      loaded: rows,
      recent: [],
      current,
      listed: true,
      more: false,
      ...over,
    });

  it("uses the rows above and below in the newest-first order, null at the ends", () => {
    expect(at("middle")).toEqual({
      kind: "found",
      previous: rows[0],
      next: rows[2],
    });
    expect(at("first")).toEqual({
      kind: "found",
      previous: null,
      next: rows[1],
    });
    expect(at("last")).toEqual({
      kind: "found",
      previous: rows[1],
      next: null,
    });
  });

  it("is none for a question that was not a saved answer when opened", () => {
    expect(at("middle", { listed: false })).toEqual({ kind: "none" });
    expect(at("middle", { listed: false, more: true })).toEqual({
      kind: "none",
    });
  });

  it("keeps finding while the row, or the row below the last one read, may be on a later page", () => {
    const restored = saved({ pollId: "older" });
    expect(at("older", { ordered: [...rows, restored], more: true })).toEqual({
      kind: "finding",
    });
    expect(at("last", { more: true })).toEqual({ kind: "finding" });
    expect(at("middle", { more: true })).toMatchObject({ kind: "found" });
    // The list ended without it: not placed, so no pager.
    expect(at("older", { ordered: [...rows, restored] })).toEqual({
      kind: "none",
    });
  });

  it("never offers a restored row appended after the loaded rows as a neighbour", () => {
    const restored = saved({ pollId: "older" });
    const ordered = [...rows, restored];
    expect(at("last", { ordered, more: true })).toEqual({ kind: "finding" });
    expect(at("last", { ordered })).toEqual({
      kind: "found",
      previous: rows[1],
      next: null,
    });
  });

  it("follows a changed row to the top", () => {
    const changed = [rows[1]!, rows[0]!, rows[2]!];
    expect(at("middle", { ordered: changed, recent: ["middle"] })).toEqual({
      kind: "found",
      previous: null,
      next: rows[0],
    });
  });
});

describe("mergedVotes (#528)", () => {
  it("keeps each question once, in first-seen order, with the newest row", () => {
    const a = saved({ pollId: "a" });
    const b = saved({ pollId: "b" });
    const newerA = saved({ pollId: "a", choices: ["No"] });
    expect(mergedVotes([a], [b, newerA])).toEqual([newerA, b]);
    expect(mergedVotes([a, b], [])).toEqual([a, b]);
  });
});
