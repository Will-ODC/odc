import { describe, expect, it } from "vitest";
import { FIRST_POLL_ID, pathOf, routeFrom } from "../src/flow/route.js";

describe("reading a URL", () => {
  it("opens the welcome when the path says nothing", () => {
    expect(routeFrom("/")).toEqual({ kind: "welcome" });
  });

  it("starts the conversation wherever ?poll= says", () => {
    expect(routeFrom("/?poll=pay-for-it")).toEqual({
      kind: "conversation",
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

  /* "Confirm with your email" names the question to come back to (#353). */
  it("keeps the question a sign-in was started from", () => {
    expect(routeFrom("/sign-in?poll=parks")).toEqual({
      kind: "signIn",
      returnTo: { kind: "conversation", pollId: "parks" },
    });
    expect(routeFrom("/sign-in?poll=")).toEqual({ kind: "signIn" });
    // A token wins: the emailed link is the one to spend.
    expect(routeFrom("/sign-in?token=abc&poll=parks")).toEqual({
      kind: "redeem",
      token: "abc",
    });
    const route = {
      kind: "signIn" as const,
      returnTo: { kind: "conversation" as const, pollId: "a b&c" },
    };
    expect(pathOf(route)).toBe("/sign-in?poll=a%20b%26c");
    expect(routeFrom(pathOf(route))).toEqual(route);
  });

  /* The posting form sends a signed-out person here, and back (ADR-0037). */
  it("opens the posting form, and a sign-in that returns to it", () => {
    expect(routeFrom("/new")).toEqual({ kind: "newPoll" });
    expect(routeFrom("/New/")).toEqual({ kind: "newPoll" });
    expect(pathOf({ kind: "newPoll" })).toBe("/new");
    const signIn = {
      kind: "signIn" as const,
      returnTo: { kind: "newPoll" as const },
    };
    expect(pathOf(signIn)).toBe("/sign-in?next=new");
    expect(routeFrom(pathOf(signIn))).toEqual(signIn);
    expect(routeFrom("/sign-in?next=elsewhere")).toEqual({ kind: "signIn" });
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

  /*
   * The original bug in miniature. A path this does not recognise falls
   * through to the run and the token is dropped in silence — so a mail client
   * that title-cases the URL would sign nobody in, exactly as before, with
   * nothing to show for it.
   */
  it("treats a differently-cased path as the same place", () => {
    expect(routeFrom("/Sign-In?token=abc123")).toEqual({
      kind: "redeem",
      token: "abc123",
    });
    expect(routeFrom("/SIGN-IN")).toEqual({ kind: "signIn" });
  });

  /* The token itself is case-sensitive — it is a secret, not a path. */
  it("does not touch the case of the token", () => {
    expect(routeFrom("/sign-in?token=AbC123")).toEqual({
      kind: "redeem",
      token: "AbC123",
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
      kind: "conversation",
      pollId: FIRST_POLL_ID,
    });
  });

  it("opens the chat preview at /preview/chat", () => {
    expect(routeFrom("/preview/chat")).toEqual({ kind: "chatPreview" });
  });

  /* The same tolerance the sign-in path has, for the same reasons. */
  it("opens the chat preview with a trailing slash or another case", () => {
    expect(routeFrom("/preview/chat/")).toEqual({ kind: "chatPreview" });
    expect(routeFrom("/Preview/Chat")).toEqual({ kind: "chatPreview" });
    expect(routeFrom("http://localhost:5173/PREVIEW/CHAT/?x=1")).toEqual({
      kind: "chatPreview",
    });
  });

  it("does not open the preview for a path that only starts like it", () => {
    expect(routeFrom("/preview")).toEqual({
      kind: "conversation",
      pollId: FIRST_POLL_ID,
    });
    expect(routeFrom("/preview/chatter")).toEqual({
      kind: "conversation",
      pollId: FIRST_POLL_ID,
    });
  });

  it("opens the welcome when ?poll= is empty", () => {
    expect(routeFrom("/?poll=")).toEqual({ kind: "welcome" });
  });
});

describe("reading the trust page's address (#351)", () => {
  it("opens the trust page at /trust, with a trailing slash or another case", () => {
    for (const path of ["/trust", "/trust/", "/Trust"]) {
      expect(routeFrom(path)).toEqual({ kind: "trust" });
    }
  });

  it("does not open the trust page for a path that only starts like it", () => {
    expect(routeFrom("/trustworthy").kind).toBe("conversation");
  });
});

describe("writing a URL", () => {
  it("names the default conversation explicitly", () => {
    expect(pathOf({ kind: "conversation", pollId: FIRST_POLL_ID })).toBe(
      "/?poll=ads-free",
    );
  });

  it("names any other starting question", () => {
    expect(pathOf({ kind: "conversation", pollId: "pay-for-it" })).toBe(
      "/?poll=pay-for-it",
    );
  });

  it("points at the sign-in form", () => {
    expect(pathOf({ kind: "signIn" })).toBe("/sign-in");
  });

  it("points at the trust page", () => {
    expect(pathOf({ kind: "trust" })).toBe("/trust");
  });

  it("points at the chat preview", () => {
    expect(pathOf({ kind: "chatPreview" })).toBe("/preview/chat");
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
    { kind: "welcome" },
    { kind: "progress" },
    { kind: "questions" },
    { kind: "conversation", pollId: FIRST_POLL_ID },
    { kind: "conversation", pollId: "pay-for-it" },
    { kind: "signIn" },
    { kind: "redeem", token: "abc123" },
    { kind: "redeem", token: "a+b/c=d" },
    { kind: "chatPreview" },
    { kind: "trust" },
  ] as const;

  for (const route of routes) {
    it(`reads back what it wrote for ${JSON.stringify(route)}`, () => {
      expect(routeFrom(pathOf(route))).toEqual(route);
    });
  }
});

it("opens and round-trips the existing conversation alias", () => {
  expect(routeFrom("/Conversation/?poll=pay-for-it")).toEqual({
    kind: "conversation",
    pollId: "pay-for-it",
  });
  for (const pollId of [FIRST_POLL_ID, "a/b?x=1"]) {
    const route = { kind: "conversation" as const, pollId };
    expect(routeFrom(pathOf(route))).toEqual(route);
  }
  expect(routeFrom("/").kind).toBe("welcome");
});
