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

describe("who am I", () => {
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
