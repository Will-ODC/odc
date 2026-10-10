import { describe, expect, it } from "vitest";
import {
  isPreviewState,
  PREVIEW_STATES,
  previewSender,
  SAMPLE_CONVERSATION,
  SAMPLE_DECISION,
  scenarioFor,
  SEND_FAILED,
} from "../src/flow/chat-preview.js";
import { accessTo } from "../src/flow/decision.js";

const now = () => Promise.resolve();

describe("the sample", () => {
  it("is a single-choice question that is open and private", () => {
    expect(SAMPLE_DECISION.choices.length).toBeGreaterThanOrEqual(2);
    expect(SAMPLE_DECISION.open).toBe(true);
    expect(SAMPLE_DECISION.privacy).toBe("private");
  });

  it("asks the sample decision somewhere in the conversation", () => {
    const asked = SAMPLE_CONVERSATION.filter(
      (message) => message.kind === "decision",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ decisionId: SAMPLE_DECISION.id });
  });

  it("gives every message its own id", () => {
    const ids = SAMPLE_CONVERSATION.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the preview states", () => {
  it("lists the four the ticket asks for", () => {
    expect(PREVIEW_STATES.map((one) => one.value)).toEqual([
      "eligible",
      "unconfirmed",
      "closed",
      "sendFails",
    ]);
  });

  it("recognises only its own states", () => {
    expect(isPreviewState("closed")).toBe(true);
    expect(isPreviewState("open")).toBe(false);
    expect(isPreviewState("")).toBe(false);
  });

  it("makes eligible answerable, and sends first time", () => {
    const scenario = scenarioFor("eligible");
    expect(accessTo(scenario.decision, scenario.eligibility)).toBe(
      "answerable",
    );
    expect(scenario.failFirst).toBe(false);
  });

  it("makes unconfirmed unanswerable on an open question", () => {
    const scenario = scenarioFor("unconfirmed");
    expect(scenario.decision.open).toBe(true);
    expect(accessTo(scenario.decision, scenario.eligibility)).toBe(
      "unconfirmed",
    );
  });

  it("closes the question without touching the sample", () => {
    const scenario = scenarioFor("closed");
    expect(accessTo(scenario.decision, scenario.eligibility)).toBe("closed");
    expect(SAMPLE_DECISION.open).toBe(true);
  });

  it("makes send-fails answerable, failing the first send", () => {
    const scenario = scenarioFor("sendFails");
    expect(accessTo(scenario.decision, scenario.eligibility)).toBe(
      "answerable",
    );
    expect(scenario.failFirst).toBe(true);
  });
});

describe("the pretend send", () => {
  it("succeeds when it is not set to fail", async () => {
    const send = previewSender(false, now);
    await expect(send("tue")).resolves.toBeUndefined();
    await expect(send("tue")).resolves.toBeUndefined();
  });

  it("fails the first attempt only", async () => {
    const send = previewSender(true, now);
    await expect(send("tue")).rejects.toThrow(SEND_FAILED);
    await expect(send("tue")).resolves.toBeUndefined();
    await expect(send("wed")).resolves.toBeUndefined();
  });

  it("waits before it answers", async () => {
    let waited = 0;
    const send = previewSender(false, () => {
      waited += 1;
      return Promise.resolve();
    });
    await send("tue");
    expect(waited).toBe(1);
  });

  /* Each sender counts on its own, so a fresh conversation fails afresh. */
  it("counts attempts per sender", async () => {
    await previewSender(true, now)("tue").catch(() => undefined);
    await expect(previewSender(true, now)("tue")).rejects.toThrow();
  });
});
