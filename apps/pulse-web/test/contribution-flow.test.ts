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
  it("leaves text it cannot read as a link for the server to judge", () => {
    expect(pollReference("https://pulse.example/?poll=")).toBe(
      "https://pulse.example/?poll=",
    );
  });
});
