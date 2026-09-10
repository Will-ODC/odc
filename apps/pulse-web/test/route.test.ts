import { describe, expect, it } from "vitest";
import { FIRST_POLL_ID, pathOf, routeFrom } from "../src/flow/route.js";

describe("reading a URL", () => {
  it("opens the first question when the path says nothing", () => {
    expect(routeFrom("/")).toEqual({ kind: "run", pollId: FIRST_POLL_ID });
  });

  it("starts the run wherever ?poll= says", () => {
    expect(routeFrom("/?poll=pay-for-it")).toEqual({
      kind: "run",
      pollId: "pay-for-it",
    });
  });

  /*
   * The break this module exists to fix. Before it, this URL — the one the
   * server emails — read as a run, dropped the token, and opened the first
   * question. Someone who clicked their link was not signed in and was given
   * no sign that anything had failed.
   */
  it("spends the token from the emailed link", () => {
    expect(routeFrom("/sign-in?token=abc123")).toEqual({
      kind: "redeem",
      token: "abc123",
    });
  });

  it("asks for a link when /sign-in carries no token", () => {
    expect(routeFrom("/sign-in")).toEqual({ kind: "signIn" });
  });

  /*
   * An empty token is not a token. Reading `""` as one would send a request
   * that can only come back "that link is incomplete", when the screen the
   * person actually needs is the one that asks for a new link.
   */
  it("asks for a link when the token is empty", () => {
    expect(routeFrom("/sign-in?token=")).toEqual({ kind: "signIn" });
  });

  it("reads a full href the same as a path", () => {
    expect(routeFrom("http://localhost:5173/sign-in?token=abc123")).toEqual({
      kind: "redeem",
      token: "abc123",
    });
  });

  /* Mail clients and proxies add these; the link still has to work. */
  it("treats a trailing slash as the same place", () => {
    expect(routeFrom("/sign-in/?token=abc123")).toEqual({
      kind: "redeem",
      token: "abc123",
    });
  });

  it("keeps a token that needed escaping", () => {
    const token = "a+b/c=d";
    expect(routeFrom(`/sign-in?token=${encodeURIComponent(token)}`)).toEqual({
      kind: "redeem",
      token,
    });
  });

  it("opens the first question for a path nothing claims", () => {
    expect(routeFrom("/somewhere-else")).toEqual({
      kind: "run",
      pollId: FIRST_POLL_ID,
    });
  });

  it("opens the first question when ?poll= is empty", () => {
    expect(routeFrom("/?poll=")).toEqual({
      kind: "run",
      pollId: FIRST_POLL_ID,
    });
  });
});

describe("writing a URL", () => {
  it("leaves the default run at the bare path", () => {
    expect(pathOf({ kind: "run", pollId: FIRST_POLL_ID })).toBe("/");
  });

  it("names any other starting question", () => {
    expect(pathOf({ kind: "run", pollId: "pay-for-it" })).toBe(
      "/?poll=pay-for-it",
    );
  });

  it("points at the sign-in form", () => {
    expect(pathOf({ kind: "signIn" })).toBe("/sign-in");
  });

  it("escapes a token on the way out", () => {
    expect(pathOf({ kind: "redeem", token: "a+b/c=d" })).toBe(
      "/sign-in?token=a%2Bb%2Fc%3Dd",
    );
  });
});

/*
 * The two halves have to agree, or a URL the app writes is one it cannot read
 * back — the shape of bug that only shows up after a reload or a shared link.
 */
describe("the two directions agree", () => {
  const routes = [
    { kind: "run", pollId: FIRST_POLL_ID },
    { kind: "run", pollId: "pay-for-it" },
    { kind: "signIn" },
    { kind: "redeem", token: "abc123" },
    { kind: "redeem", token: "a+b/c=d" },
  ] as const;

  for (const route of routes) {
    it(`reads back what it wrote for ${JSON.stringify(route)}`, () => {
      expect(routeFrom(pathOf(route))).toEqual(route);
    });
  }
});
