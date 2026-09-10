import { describe, expect, it } from "vitest";
import { looksLikeEmail } from "../src/flow/email.js";

describe("what is worth sending to the server", () => {
  it("accepts an ordinary school address", () => {
    expect(looksLikeEmail("jo@student.ubc.ca")).toBe(true);
  });

  it("accepts an address with a dot in the name", () => {
    expect(looksLikeEmail("jo.chen@student.ubc.ca")).toBe(true);
  });

  it("ignores space either side", () => {
    expect(looksLikeEmail("  jo@student.ubc.ca  ")).toBe(true);
  });

  it("refuses an empty field", () => {
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("   ")).toBe(false);
  });

  it("refuses an address with no @", () => {
    expect(looksLikeEmail("jo.student.ubc.ca")).toBe(false);
  });

  it("refuses an address with nothing before or after the @", () => {
    expect(looksLikeEmail("@student.ubc.ca")).toBe(false);
    expect(looksLikeEmail("jo@")).toBe(false);
  });

  /* The typo this check is really for: a hostname where a domain belongs. */
  it("refuses a domain with no dot", () => {
    expect(looksLikeEmail("jo@ubc")).toBe(false);
  });

  it("refuses an address with a space in it", () => {
    expect(looksLikeEmail("jo smith@ubc.ca")).toBe(false);
  });

  it("refuses an address longer than the standard allows", () => {
    expect(looksLikeEmail(`${"a".repeat(250)}@ubc.ca`)).toBe(false);
  });

  /*
   * The failure worth guarding against is the opposite of a typo: a client
   * rule stricter than the server's refuses addresses that would have worked,
   * and the person has no way to argue with it. The server takes the last @,
   * so this address is valid there and must not be blocked here.
   */
  it("lets through what the server would accept but a naive rule would not", () => {
    expect(looksLikeEmail("jo+ubc@student.ubc.ca")).toBe(true);
    expect(looksLikeEmail("o'brien@student.ubc.ca")).toBe(true);
  });
});
