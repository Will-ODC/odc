import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Test setup imports both apps directly; this workspace declares both dependencies.
// The production browser app uses only the public HTTP API.
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../../../apps/pulse/src/identity/allowlist.js";
import { ClaimService } from "../../../apps/pulse/src/identity/claim.js";
import { ConsoleMailer } from "../../../apps/pulse/src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../../../apps/pulse/src/identity/store.js";
import {
  InMemoryMemberProfileStore,
  memoryDisplayNames,
} from "../../../apps/pulse/src/profiles/memory-store.js";
import { ConfirmationKey } from "../../../apps/pulse/src/voting/confirmation.js";
import { InMemoryVotingStore } from "../../../apps/pulse/src/voting/store.js";
import { InMemorySuggestionStore } from "../../../apps/pulse/src/voting/suggestions.js";
import { createServer } from "../../../apps/pulse/src/http/server.js";
import { SessionSigner } from "../../../apps/pulse/src/http/session.js";
import { HttpPulseApi } from "../../../apps/pulse-web/src/api/http.js";
import { ApiError } from "../../../apps/pulse-web/src/api/types.js";

/**
 * ADR-0048 step 2 over a real socket, with today's browser client: a client
 * that has never heard of public-vote polls can never cast a named vote, and
 * the routes whose answer depends on the cookies say so to every cache.
 * Public-vote polls are made through the voting store, because creation
 * still refuses the setting.
 */

type PulseServer = Awaited<ReturnType<typeof createServer>>;
const WEB_ORIGIN = "http://localhost:5173";
const EMAIL = "jo@student.ubc.ca";

/** One browser: a cookie jar around `fetch`, and the real client on it. */
function browser(base: string, seed = "") {
  let cookie = seed;
  const request: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", WEB_ORIGIN);
    const response = await fetch(input, { ...init, headers });
    const jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((pair) => pair.split("=", 2) as [string, string]),
    );
    for (const raw of response.headers.getSetCookie()) {
      const [name, value] = (raw.split(";")[0] ?? "").split("=", 2);
      if (name) jar.set(name, value ?? "");
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return response;
  };
  return {
    api: new HttpPulseApi(base, request),
    fetch: request,
    cookies: () => cookie,
  };
}

describe("public-vote polls over HTTP", () => {
  let app: PulseServer;
  let mailer: ConsoleMailer;
  let base: string;
  let votes: InMemoryVotingStore;

  beforeEach(async () => {
    mailer = new ConsoleMailer(() => {});
    const voters = new InMemoryVoterStore();
    votes = new InMemoryVotingStore(undefined, {
      displayNameOf: memoryDisplayNames(voters),
    });
    await votes.createPoll({
      id: "pub",
      question: "Which park?",
      choices: ["North", "South"],
      method: "single",
      votePrivacy: "public",
    });
    app = await createServer({
      claims: new ClaimService({
        membership: new DomainAllowlist(
          new StaticDomainSource([
            { community: "ubc-students", domain: "student.ubc.ca" },
          ]),
        ),
        voters,
        claims: new InMemoryClaimStore(),
        mailer,
        linkFor: (token) =>
          `${WEB_ORIGIN}/sign-in?token=${encodeURIComponent(token)}`,
      }),
      voters,
      votes,
      profiles: new InMemoryMemberProfileStore(voters),
      suggestions: new InMemorySuggestionStore(),
      signer: new SessionSigner("a-test-secret-long-enough-x-x-x-x"),
      confirmationKey: new ConfirmationKey(
        "a-test-confirmation-key-long-enough",
      ),
      webOrigin: WEB_ORIGIN,
      secureCookies: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterEach(async () => {
    await app.close();
  });

  async function signedIn(email = EMAIL) {
    const one = browser(base);
    await one.api.requestLink(email, false);
    const link = mailer.lastTo(email)?.body ?? "";
    const me = await one.api.redeem(
      new URL(link).searchParams.get("token") ?? "",
    );
    return { ...one, me };
  }

  it("today's client is refused with 409 and nothing is written or minted", async () => {
    const jo = await signedIn();
    const refused = await jo.api.cast("pub", [0]).catch((error) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({
      status: 409,
      code: "vote_privacy_mismatch",
    });
    expect(jo.cookies()).not.toContain("pulse_ballot=");
    expect((await votes.results("pub")).voters).toBe(0);
    expect((await jo.api.poll("pub")) as unknown).toMatchObject({
      votePrivacy: "public",
    });
  });

  it("an acknowledged vote is the account's from a browser holding only the session", async () => {
    const jo = await signedIn();
    const cast = await jo.fetch(`${base}/polls/pub/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballot: [1], publicVote: true }),
    });
    expect(cast.status).toBe(200);
    expect(cast.headers.getSetCookie()).toEqual([]);
    expect(await cast.json()).toMatchObject({
      status: "counted",
      ballot: [1],
      results: { voters: 1, confirmedVoters: 1, votePrivacy: "public" },
    });

    // Another browser, signed in as the same account and with no ballot.
    const session = jo
      .cookies()
      .split("; ")
      .find((pair) => pair.startsWith("pulse_session="));
    const other = browser(base, session);
    expect(await other.api.myBallot("pub")).toEqual([1]);
    const page = await other.api.myVotes();
    expect(page.votes.map((v) => [v.pollId, v.ballot])).toEqual([["pub", [1]]]);
    expect(other.cookies()).toBe(session);

    // Signed out, there is no ballot and none is minted.
    const stranger = browser(base);
    expect(await stranger.api.myBallot("pub")).toBeNull();
    expect(stranger.cookies()).toBe("");
  });

  it("ballot and my votes tell every cache the answer is per cookie", async () => {
    for (const path of [
      "/polls/pub/ballot",
      "/polls/missing/ballot",
      "/my-votes",
      "/my-votes?limit=0",
    ]) {
      const reply = await fetch(`${base}${path}`);
      expect(reply.headers.get("cache-control"), path).toBe(
        "private, no-store",
      );
      expect(reply.headers.get("vary"), path).toBe("Cookie");
    }
  });

  it("the profile editor's save is refused for the reserved name", async () => {
    const jo = await signedIn();
    const refused = await jo.api
      .saveProfile({
        ownerAccountId: jo.me.id,
        displayName: "Verified Voter",
        bio: "",
        visible: true,
      })
      .catch((error) => error);
    expect(refused).toMatchObject({ status: 400, code: "reserved_name" });
    expect(await jo.api.myProfile()).toBeNull();
  });

  /** An acknowledged public cast from this browser, as step 4a's card will send. */
  async function castPublic(
    who: Awaited<ReturnType<typeof signedIn>>,
    ballot: number[],
  ) {
    const reply = await who.fetch(`${base}/polls/pub/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballot, publicVote: true }),
    });
    expect(reply.status).toBe(200);
  }

  it("the public list pages through opaque cursors in the URL and is never cached", async () => {
    for (const [i, email] of [
      "ana@student.ubc.ca",
      "ben@student.ubc.ca",
      "cat@student.ubc.ca",
    ].entries()) {
      await castPublic(await signedIn(email), [i % 2]);
    }
    const seen: unknown[] = [];
    let url = `${base}/polls/pub/public-votes?limit=2`;
    for (;;) {
      const reply = await fetch(url);
      expect(reply.status).toBe(200);
      expect(reply.headers.get("cache-control")).toBe("no-store");
      expect(reply.headers.getSetCookie()).toEqual([]);
      const page = (await reply.json()) as {
        items: { name: string | null; choices: number[] }[];
        nextCursor: string | null;
      };
      seen.push(...page.items);
      if (page.nextCursor === null) break;
      expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      url = `${base}/polls/pub/public-votes?limit=2&cursor=${page.nextCursor}`;
    }
    // Nobody has a profile, so every name is null ("Verified voter").
    expect(seen).toHaveLength(3);
    expect(
      seen.every((item) => (item as { name: unknown }).name === null),
    ).toBe(true);
    const missing = await fetch(`${base}/polls/missing/public-votes`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("removing one's own public vote works over HTTP and only from the web origin", async () => {
    const jo = await signedIn();
    await castPublic(jo, [1]);

    const session = jo
      .cookies()
      .split("; ")
      .find((pair) => pair.startsWith("pulse_session="));
    const foreign = await fetch(`${base}/polls/pub/votes/mine`, {
      method: "DELETE",
      headers: { cookie: session ?? "", origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect((await votes.results("pub")).voters).toBe(1);

    const removed = await jo.fetch(`${base}/polls/pub/votes/mine`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      status: "removed",
      results: { voters: 0, votePrivacy: "public" },
    });
    expect(await jo.api.myBallot("pub")).toBeNull();
    const list = await fetch(`${base}/polls/pub/public-votes`);
    expect(await list.json()).toEqual({ items: [], nextCursor: null });
  });
});
