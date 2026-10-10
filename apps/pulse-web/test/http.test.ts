import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpPulseApi } from "../src/api/http.js";
import { ApiError } from "../src/api/types.js";

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
      JSON.stringify({ email: "jo@x.test", proofEmailsOptIn: true }),
    );
    // The server's own sentence is carried, not dropped: the screen that
    // follows should not have to invent copy the API already documents.
    expect(result).toEqual({ status: "sent", message: "Check your email." });
  });

  it("reports it as sent even when the server sends no sentence", async () => {
    stubFetch({ body: JSON.stringify({ status: "sent" }) });
    expect(await new HttpPulseApi().requestLink("jo@x.test", false)).toEqual({
      status: "sent",
    });
  });

  it("rejects a 403 not_a_member like any other refusal (open sign-up, ADR-0030)", async () => {
    stubFetch({
      status: 403,
      body: JSON.stringify({
        error: "not_a_member",
        message: "gmail.com is not part of a community on pulse yet.",
      }),
    });
    await expect(
      new HttpPulseApi().requestLink("jo@gmail.com", false),
    ).rejects.toThrow(ApiError);
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

  // P2: one refusal is a question, and comes back as an answer.
  const CHOOSE = {
    error: "choose_community",
    message: "That address can sign in to more than one community. Choose one.",
    communities: [{ id: "ubc-alumni" }, { id: "ubc-staff" }],
  };

  it("returns the choice of communities rather than throwing", async () => {
    stubFetch({ status: 422, body: JSON.stringify(CHOOSE) });
    expect(await new HttpPulseApi().requestLink("jo@ubc.ca", false)).toEqual({
      status: "choose_community",
      communities: [{ id: "ubc-alumni" }, { id: "ubc-staff" }],
    });
  });

  it("sends the pick as community, and leaves it out when there is none", async () => {
    const calls = stubFetch({ body: JSON.stringify({ status: "sent" }) });
    await new HttpPulseApi().requestLink("jo@ubc.ca", true, "ubc-staff");
    await new HttpPulseApi().requestLink("jo@ubc.ca", true);
    expect(calls[0]?.init.body).toBe(
      JSON.stringify({
        email: "jo@ubc.ca",
        proofEmailsOptIn: true,
        community: "ubc-staff",
      }),
    );
    expect(calls[1]?.init.body).toBe(
      JSON.stringify({ email: "jo@ubc.ca", proofEmailsOptIn: true }),
    );
  });

  it("refuses a list of communities it could not offer anyone", async () => {
    for (const communities of [undefined, [], [{ id: "" }], ["ubc-staff"]]) {
      stubFetch({
        status: 422,
        body: JSON.stringify({ ...CHOOSE, communities }),
      });
      await expect(
        new HttpPulseApi().requestLink("jo@ubc.ca", false),
      ).rejects.toThrow("pulse sent a response the app couldn't read.");
    }
  });

  it("refuses a community question with duplicate choices", async () => {
    stubFetch({
      status: 422,
      body: JSON.stringify({
        ...CHOOSE,
        communities: [{ id: "ubc-staff" }, { id: "ubc-staff" }],
      }),
    });
    await expect(
      new HttpPulseApi().requestLink("jo@ubc.ca", false),
    ).rejects.toThrow("pulse sent a response the app couldn't read.");
  });

  it("refuses a community question with only one choice", async () => {
    stubFetch({
      status: 422,
      body: JSON.stringify({ ...CHOOSE, communities: [{ id: "ubc-staff" }] }),
    });
    await expect(
      new HttpPulseApi().requestLink("jo@ubc.ca", false),
    ).rejects.toThrow("pulse sent a response the app couldn't read.");
  });

  it("still throws on a 422 that is not the community question, and on a bad pick", async () => {
    stubFetch({
      status: 422,
      body: JSON.stringify({ error: "something_else", message: "No." }),
    });
    await expect(
      new HttpPulseApi().requestLink("jo@ubc.ca", false),
    ).rejects.toThrow("No.");

    stubFetch({
      status: 400,
      body: JSON.stringify({
        error: "unknown_community",
        message: "That address cannot sign in to that community.",
      }),
    });
    const refused = await new HttpPulseApi()
      .requestLink("jo@ubc.ca", false, "made-up")
      .catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).code).toBe("unknown_community");
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

  // A proxy's own error page (nginx's 502/504, a dropped upstream) carries no
  // sentence. The person sees what follows, so it is words, never a number.
  async function messageFor(status: number, body: string): Promise<string> {
    stubFetch({ status, body });
    const error = await new HttpPulseApi().poll("p1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return (error as ApiError).message;
  }

  it.each([500, 502, 503, 504])(
    "says a %i without a sentence is our fault and worth retrying",
    async (status) => {
      expect(await messageFor(status, "<html>gateway</html>")).toBe(
        "Something went wrong. Try again.",
      );
    },
  );

  it("says a 429 without a sentence means wait, not retry now", async () => {
    expect(await messageFor(429, "")).toBe(
      "Too many tries just now. Try again a little later.",
    );
  });

  it("says a 404 without a sentence means there is nothing there", async () => {
    expect(await messageFor(404, "<html>not found</html>")).toBe(
      "There is nothing here.",
    );
  });

  it("says a 410 without a sentence means ask for a new link, not retry", async () => {
    const said = await messageFor(410, "");
    expect(said).toBe("That link no longer works. Ask for a new one.");
    expect(said).not.toContain("Try again");
  });

  it("gives any other refusal without a sentence a plain one", async () => {
    expect(await messageFor(418, "")).toBe("That didn't work. Try again.");
  });

  it("never shows the status number when the body carries no message", async () => {
    for (const status of [400, 403, 409, 410, 429, 500, 502, 503, 504]) {
      expect(await messageFor(status, "")).not.toMatch(/\d{3}/);
    }
  });

  it("keeps the server's sentence over the fallback, even on a 5xx", async () => {
    // A different sentence from the fallback's, so this can tell them apart.
    expect(
      await messageFor(
        500,
        JSON.stringify({ message: "The poll store is restarting." }),
      ),
    ).toBe("The poll store is restarting.");
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
