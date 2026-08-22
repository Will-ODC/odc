import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpPulseApi } from "../src/api/http.js";

/** Replaces fetch with one canned response, and records what was requested. */
function stubFetch(
  response: { status?: number; body?: string } | { throws: true },
) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if ("throws" in response) throw new TypeError("Failed to fetch");
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => response.body ?? "",
    } as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("reading a poll", () => {
  it("returns the parsed body", async () => {
    stubFetch({ body: JSON.stringify({ id: "p1", choices: ["a"] }) });
    expect(await new HttpPulseApi().poll("p1")).toEqual({
      id: "p1",
      choices: ["a"],
    });
  });

  it("escapes the poll id into the path", async () => {
    const calls = stubFetch({ body: "{}" });
    await new HttpPulseApi().poll("a/b?c");
    expect(calls[0]?.url).toBe("/api/polls/a%2Fb%3Fc");
  });

  it("sends the session cookie", async () => {
    const calls = stubFetch({ body: "{}" });
    await new HttpPulseApi().poll("p1");
    expect(calls[0]?.init.credentials).toBe("same-origin");
  });
});

describe("asking for a sign-in link", () => {
  it("posts to the path the server serves, with the server's own opt-in name", async () => {
    const calls = stubFetch({
      body: JSON.stringify({ status: "sent", message: "Check your email." }),
    });
    const result = await new HttpPulseApi().requestLink("jo@x.test", true);

    expect(calls[0]?.url).toBe("/api/sign-in");
    expect(calls[0]?.init.body).toBe(
      JSON.stringify({ email: "jo@x.test", wantsProofEmails: true }),
    );
    expect(result).toEqual({ status: "sent" });
  });

  it("turns the 403 for an unclaimed domain into an answer, showing the server's sentence", async () => {
    stubFetch({
      status: 403,
      body: JSON.stringify({
        error: "not_a_member",
        message: "gmail.com is not part of a community on pulse yet.",
      }),
    });
    expect(await new HttpPulseApi().requestLink("jo@gmail.com", false)).toEqual(
      {
        status: "not_eligible",
        message: "gmail.com is not part of a community on pulse yet.",
      },
    );
  });

  it("still throws on a 403 that is not about membership", async () => {
    stubFetch({
      status: 403,
      body: JSON.stringify({ error: "forbidden", message: "No." }),
    });
    await expect(
      new HttpPulseApi().requestLink("jo@x.test", false),
    ).rejects.toThrow(ApiError);
  });

  it("reports a refused address as a failure, not as a sent link", async () => {
    stubFetch({
      status: 400,
      body: JSON.stringify({
        error: "invalid_email",
        message: "That does not look like an email address.",
      }),
    });
    await expect(new HttpPulseApi().requestLink("nope", false)).rejects.toThrow(
      "That does not look like an email address.",
    );
  });
});

describe("redeeming a link", () => {
  it("posts the token to the redeem path and unwraps the voter", async () => {
    const calls = stubFetch({
      body: JSON.stringify({
        status: "signed_in",
        voter: { id: "v1", email: "jo@x.test", community: "c" },
        firstTime: true,
      }),
    });
    const me = await new HttpPulseApi().redeem("t0k3n");

    expect(calls[0]?.url).toBe("/api/sign-in/redeem");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ token: "t0k3n" }));
    expect(me).toEqual({ id: "v1", email: "jo@x.test", community: "c" });
  });
});

describe("signing out", () => {
  it("posts to the sign-out path", async () => {
    const calls = stubFetch({ body: JSON.stringify({ status: "signed_out" }) });
    await new HttpPulseApi().signOut();
    expect(calls[0]?.url).toBe("/api/sign-out");
    expect(calls[0]?.init.method).toBe("POST");
  });
});

describe("who am I", () => {
  it("unwraps the voter envelope", async () => {
    stubFetch({
      body: JSON.stringify({
        voter: { id: "v1", email: "jo@x.test", community: "c" },
      }),
    });
    expect(await new HttpPulseApi().me()).toEqual({
      id: "v1",
      email: "jo@x.test",
      community: "c",
    });
  });

  it("treats 401 as not signed in, not as a failure", async () => {
    stubFetch({ status: 401, body: JSON.stringify({ message: "no session" }) });
    expect(await new HttpPulseApi().me()).toBeNull();
  });

  it("still reports other failures", async () => {
    stubFetch({ status: 500, body: JSON.stringify({ message: "boom" }) });
    await expect(new HttpPulseApi().me()).rejects.toThrow(ApiError);
  });
});

describe("failures", () => {
  it("shows the server's own sentence", async () => {
    stubFetch({
      status: 400,
      body: JSON.stringify({ message: "Pick one of the choices." }),
    });
    await expect(new HttpPulseApi().cast("p1", [9])).rejects.toThrow(
      "Pick one of the choices.",
    );
  });

  it("falls back to a status when the body carries no message", async () => {
    stubFetch({ status: 503, body: "<html>gateway</html>" });
    await expect(new HttpPulseApi().poll("p1")).rejects.toThrow(
      "Request failed (503)",
    );
  });

  it("rejects a 2xx body it cannot read, rather than resolving to null", async () => {
    // A proxy's HTML page with a 200 would otherwise surface much later, as a
    // property access on nothing, inside a screen.
    stubFetch({ status: 200, body: "<html>hello</html>" });
    await expect(new HttpPulseApi().poll("p1")).rejects.toThrow(ApiError);
  });

  it("turns a dropped connection into an ApiError like every other failure", async () => {
    stubFetch({ throws: true });
    const error = await new HttpPulseApi().poll("p1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});

describe("ballots", () => {
  it("unwraps the ballot envelope", async () => {
    stubFetch({ body: JSON.stringify({ ballot: [1, 2] }) });
    expect(await new HttpPulseApi().myBallot("p1")).toEqual([1, 2]);
  });

  it("reports no ballot as null", async () => {
    stubFetch({ body: JSON.stringify({ ballot: null }) });
    expect(await new HttpPulseApi().myBallot("p1")).toBeNull();
  });

  it("posts the ballot as an array", async () => {
    const calls = stubFetch({ body: JSON.stringify({ status: "counted" }) });
    await new HttpPulseApi().cast("p1", [0, 2]);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ ballot: [0, 2] }));
  });
});
