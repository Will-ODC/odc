import { describe, expect, it } from "vitest";
import {
  RETURN_LIFETIME_MS,
  rememberReturn,
  takeReturn,
} from "../src/flow/sign-in-return.js";
import type { ReturnStore } from "../src/flow/sign-in-return.js";

/** A plain map standing in for `localStorage`. */
function memory(): ReturnStore & { size: () => number } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    size: () => map.size,
  };
}

describe("the question to come back to after signing in (#353)", () => {
  it("is read back once, then forgotten", () => {
    const store = memory();
    rememberReturn("parks", store, 1_000);
    expect(takeReturn(store, 2_000)).toBe("parks");
    expect(takeReturn(store, 2_000)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("is ignored after an hour, and forgotten anyway", () => {
    const store = memory();
    rememberReturn("parks", store, 0);
    expect(takeReturn(store, RETURN_LIFETIME_MS + 1)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("is still good at exactly an hour", () => {
    const store = memory();
    rememberReturn("parks", store, 0);
    expect(takeReturn(store, RETURN_LIFETIME_MS)).toBe("parks");
  });

  it("is dropped when a later sign-in names no question", () => {
    const store = memory();
    rememberReturn("parks", store, 0);
    rememberReturn(undefined, store, 1);
    expect(takeReturn(store, 2)).toBeNull();
  });

  it("refuses an id longer than any poll id", () => {
    const store = memory();
    rememberReturn("x".repeat(201), store, 0);
    expect(takeReturn(store, 1)).toBeNull();
  });

  it("ignores anything this file did not write", () => {
    for (const raw of [
      "not json",
      "null",
      '"parks"',
      '{"pollId":"parks"}',
      '{"pollId":7,"at":0}',
      '{"pollId":"","at":0}',
      '{"pollId":"parks","at":"0"}',
      // From the future: a clock that moved back, or a hand-edited value.
      '{"pollId":"parks","at":5000}',
    ]) {
      const store = memory();
      store.setItem("pulse.signInReturn", raw);
      expect(takeReturn(store, 1_000), raw).toBeNull();
    }
  });

  it("does nothing, and throws nothing, without storage", () => {
    expect(() => rememberReturn("parks", null)).not.toThrow();
    expect(takeReturn(null)).toBeNull();
  });

  it("survives storage that refuses every call", () => {
    const refusing: ReturnStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberReturn("parks", refusing)).not.toThrow();
    expect(takeReturn(refusing)).toBeNull();
  });
});
