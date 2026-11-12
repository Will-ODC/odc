import { describe, expect, it } from "vitest";
import { pollReference } from "../src/flow/contributions.js";

describe("pollReference", () => {
  it("takes the poll ID out of a pasted question link", () => {
    expect(pollReference(" https://pulse.example/?poll=garden ")).toBe(
      "garden",
    );
    expect(pollReference("/?poll=garden&x=1")).toBe("garden");
  });
  it("keeps a bare ID, and blank stays blank", () => {
    expect(pollReference(" garden ")).toBe("garden");
    expect(pollReference("   ")).toBe("");
  });
  it("rejects text that is neither a question link nor an ID", () => {
    expect(pollReference("https://pulse.example/?poll=")).toBeUndefined();
    expect(pollReference("https://pulse.example/questions/garden")).toBe(
      undefined,
    );
    expect(pollReference("not an id")).toBeUndefined();
    expect(pollReference("x".repeat(129))).toBeUndefined();
    expect(pollReference("x".repeat(128))).toBe("x".repeat(128));
  });
});
