import { beforeEach, describe, expect, it } from "vitest";
import { DemoPulseApi, type DemoOptions } from "../src/api/demo.js";

const base: DemoOptions = {
  poll: {
    id: "p1",
    question: "Which one?",
    choices: ["a", "b", "c"],
    method: "single",
  },
  allowedDomain: "student.ubc.ca",
  community: "ubc-students",
  otherVotes: [3, 2, 1],
};

const api = (over: Partial<DemoOptions> = {}) =>
  new DemoPulseApi({ ...base, ...over });

describe("asking for a link", () => {
  it("turns away an address outside the community", async () => {
    const result = await api().requestLink("someone@gmail.com", true);
    expect(result.status).toBe("not_eligible");
  });

  it("accepts the allowed domain whatever case it is typed in", async () => {
    expect((await api().requestLink("JO@Student.UBC.ca", true)).status).toBe(
      "sent",
    );
  });

  it("matches the allowed domain even when it is configured in mixed case", async () => {
    const mixed = api({ allowedDomain: "Student.UBC.ca" });
    expect((await mixed.requestLink("jo@student.ubc.ca", true)).status).toBe(
      "sent",
    );
  });

  it("does not sign anyone in until the link is redeemed", async () => {
    const demo = api();
    await demo.requestLink("jo@student.ubc.ca", true);
    expect(await demo.me()).toBeNull();
    await demo.redeem();
    expect((await demo.me())?.email).toBe("jo@student.ubc.ca");
  });

  it("refuses to redeem a link that was never asked for", async () => {
    await expect(api().redeem()).rejects.toThrow();
  });
});

describe("voting", () => {
  let demo: DemoPulseApi;
  beforeEach(async () => {
    demo = api();
    await demo.requestLink("jo@student.ubc.ca", true);
    await demo.redeem();
  });

  it("counts the first vote and changes the second", async () => {
    expect((await demo.cast("p1", [0])).status).toBe("counted");
    expect((await demo.cast("p1", [1])).status).toBe("changed");
    expect(await demo.myBallot()).toEqual([1]);
  });

  it("moves the count when a vote changes, never double-counting", async () => {
    await demo.cast("p1", [0]);
    const after = await demo.cast("p1", [1]);
    expect(after.status === "changed" && after.results.choices[0]?.count).toBe(
      3,
    );
    expect(after.status === "changed" && after.results.choices[1]?.count).toBe(
      3,
    );
    expect(after.status === "changed" && after.results.voters).toBe(7);
  });

  it("keeps a stored ballot sorted", async () => {
    const approval = api({ poll: { ...base.poll, method: "approval" } });
    await approval.requestLink("jo@student.ubc.ca", true);
    await approval.redeem();
    await approval.cast("p1", [2, 0]);
    expect(await approval.myBallot()).toEqual([0, 2]);
  });
});

describe("results", () => {
  it("counts one voter per person, not per selection, under approval", async () => {
    // Eight people, each of whom approved several options.
    const approval = api({
      poll: { ...base.poll, method: "approval" },
      otherVotes: [8, 6, 4],
      otherVoters: 10,
    });
    const results = await approval.results();

    expect(results.voters).toBe(10);
    const total = results.choices.reduce((sum, c) => sum + c.share, 0);
    expect(total).toBeGreaterThan(100); // approval shares must NOT sum to 100
    expect(results.choices.map((c) => c.share)).toEqual([80, 60, 40]);
  });

  it("falls back to the sum of the standings, which is right for single choice", async () => {
    expect((await api().results()).voters).toBe(6);
  });

  it("reports zero shares rather than dividing by zero", async () => {
    const empty = api({ otherVotes: [0, 0, 0] });
    const results = await empty.results();
    expect(results.voters).toBe(0);
    expect(results.choices.map((c) => c.share)).toEqual([0, 0, 0]);
  });

  it("rounds a share to one decimal", async () => {
    const thirds = api({ otherVotes: [1, 1, 1] });
    expect((await thirds.results()).choices[0]?.share).toBe(33.3);
  });
});

describe("a closed poll", () => {
  it("refuses a vote and leaves the results alone", async () => {
    const closed = api({ poll: { ...base.poll, open: false } });
    await closed.requestLink("jo@student.ubc.ca", true);
    await closed.redeem();

    expect((await closed.cast("p1", [0])).status).toBe("closed");
    expect(await closed.myBallot()).toBeNull();
    expect((await closed.results()).voters).toBe(6);
  });

  it("reports itself as closed so the screen can say so", async () => {
    const closed = api({
      poll: { ...base.poll, open: false, closesAt: "2026-08-07T17:00:00Z" },
    });
    const poll = await closed.poll();
    expect(poll.open).toBe(false);
    expect(poll.closesAt).toBe("2026-08-07T17:00:00Z");
  });
});
