import { describe, expect, it } from "vitest";
import type { MyVote } from "../src/api/types.js";
import { answeredList } from "../src/flow/answered.js";
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
    expect(answeredList(list, [], NOW)).toEqual(list);
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
    const list = answeredList(server, [{ poll: parks, ballot: [0] }], NOW);
    expect(list.map((vote) => [vote.pollId, vote.choices])).toEqual([
      ["parks", ["No"]],
      ["fixes", ["Yes"]],
    ]);
  });

  it("keeps the server's place for an answer it already has", () => {
    const server = [saved({ pollId: "fixes" }), saved()];
    const parks = poll({ id: "parks", question: "More parks?" });
    expect(answeredList(server, [{ poll: parks, ballot: [1] }], NOW)).toEqual(
      server,
    );
  });

  it("orders an approval ballot and says when the question has closed", () => {
    const fixes = poll({
      id: "fixes",
      choices: ["Park", "Library", "Rink"],
      method: "approval",
      closesAt: "2026-11-07T11:00:00.000Z",
    });
    const [vote] = answeredList([], [{ poll: fixes, ballot: [2, 0] }], NOW);
    expect(vote!.ballot).toEqual([0, 2]);
    expect(vote!.choices).toEqual(["Park", "Rink"]);
    expect(vote!.open).toBe(false);
  });
});
