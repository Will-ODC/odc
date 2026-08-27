import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The server, imported by path rather than as a package: pulse is one epic in
// two workspace packages, `@odc/pulse` publishes no build artefacts, and this
// is the one place that needs both halves at once. Nothing in `src/` imports
// across — only this proof does. The imports are deep because the package has
// no public surface to import from; it needs one when it has a consumer that
// is not a test.
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../../pulse/src/identity/allowlist.js";
import { ClaimService } from "../../pulse/src/identity/claim.js";
import { ConsoleMailer } from "../../pulse/src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../../pulse/src/identity/store.js";
import { InMemorySuggestionStore } from "../../pulse/src/voting/suggestions.js";
import { InMemoryVotingStore } from "../../pulse/src/voting/store.js";
import { createServer } from "../../pulse/src/http/server.js";
import { SessionSigner } from "../../pulse/src/http/session.js";
import { HttpPulseApi } from "../src/api/http.js";

/**
 * Fastify's own type, reached through `createServer` rather than by importing
 * `fastify` — that package is a dependency of `@odc/pulse`, not of this one,
 * and this test has no business declaring it.
 */
type PulseServer = Awaited<ReturnType<typeof createServer>>;

/**
 * The proof that the client and the server actually speak to each other: a real
 * Fastify server on a real socket, the real `HttpPulseApi` pointed at it, and
 * the whole sign-in-and-vote flow driven end to end over HTTP.
 *
 * Nothing is stubbed except the browser itself. `fetch` in Node keeps no cookie
 * jar, so the wrapper below does what a browser would — and only that. The
 * client is untouched.
 */

const ALLOWED = "student.ubc.ca";
const COMMUNITY = "ubc-students";
const POLL_ID = "p1";
/** The poll `p1`'s first choice opens, and the one that takes options of its own. */
const SUGGESTS_ID = "p2";

/**
 * A cookie jar wrapped around `fetch`, which is the one thing Node lacks.
 *
 * Passed to the client rather than installed over the global, so there is no
 * restore to remember and no order to get wrong. It honours `credentials` the
 * way a browser does: without that the proof would be unfalsifiable, since
 * undici sends whatever `cookie` header it is handed regardless of the mode,
 * and a client that asked for `omit` — losing its session in a real browser the
 * moment it signed in — would still pass everything here.
 */
function cookieJar(): { fetch: typeof fetch; header(): string | undefined } {
  const jar = new Map<string, string>();
  const header = () =>
    jar.size === 0
      ? undefined
      : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  const doFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const cookie = header();
    if (cookie !== undefined && init?.credentials !== "omit") {
      headers.set("cookie", cookie);
    }
    const response = await globalThis.fetch(input, { ...init, headers });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      // An empty value is how the server clears a cookie on sign-out.
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };

  return { fetch: doFetch, header };
}

/** The token out of the link the mailer printed, as a person's click would carry it. */
function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();
  return token as string;
}

describe("the client against the real server", () => {
  let app: PulseServer;
  let mailer: ConsoleMailer;
  let api: HttpPulseApi;
  let jar: ReturnType<typeof cookieJar>;
  let baseUrl: string;

  beforeEach(async () => {
    mailer = new ConsoleMailer(() => {});
    const voters = new InMemoryVoterStore();
    const votes = new InMemoryVotingStore();
    await votes.createPoll({
      id: POLL_ID,
      question: "Where should the next one be?",
      choices: ["Park", "Library", "Rink"],
      method: "single",
      next: [SUGGESTS_ID, null, null],
    });
    await votes.createPoll({
      id: SUGGESTS_ID,
      question: "What should be there?",
      choices: ["Benches", "Trees"],
      method: "single",
      acceptsSuggestions: true,
    });

    app = await createServer({
      claims: new ClaimService({
        membership: new DomainAllowlist(
          new StaticDomainSource([{ community: COMMUNITY, domain: ALLOWED }]),
        ),
        voters,
        claims: new InMemoryClaimStore(),
        mailer,
        linkFor: (token) =>
          `http://localhost:5173/sign-in?token=${encodeURIComponent(token)}`,
      }),
      voters,
      votes,
      suggestions: new InMemorySuggestionStore(),
      signer: new SessionSigner("a-test-secret-long-enough"),
      secureCookies: false,
    });

    // Port 0: the OS picks a free one, so parallel test files never collide.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    jar = cookieJar();
    baseUrl = `http://127.0.0.1:${port}/api`;
    api = new HttpPulseApi(baseUrl, jar.fetch);
  });

  afterEach(async () => {
    await app.close();
  });

  it("signs a member in from an emailed link, votes, and signs out again", async () => {
    expect(await api.me()).toBeNull();

    expect(await api.requestLink("jo@student.ubc.ca", true)).toEqual({
      status: "sent",
      message: "Check your email for a link to sign in.",
    });

    const link = mailer.lastTo("jo@student.ubc.ca");
    expect(link?.kind).toBe("claim-link");

    const me = await api.redeem(tokenFromLink(link?.body ?? ""));
    expect(me).toEqual({
      id: expect.any(String),
      email: "jo@student.ubc.ca",
      community: COMMUNITY,
    });

    // The session cookie the redeem set is what carries the next calls.
    expect(await api.me()).toEqual(me);

    const outcome = await api.cast(POLL_ID, [1]);
    expect(outcome.status).toBe("counted");
    expect(outcome.status === "counted" && outcome.results.voters).toBe(1);
    expect(await api.myBallot(POLL_ID)).toEqual([1]);

    // Kept before signing out, so the assertion below can present it again the
    // way someone holding a copy of the cookie would.
    const cookieBeforeSignOut = jar.header();
    expect(cookieBeforeSignOut).toContain("pulse_session=");

    await api.signOut();
    expect(await api.me()).toBeNull();

    // Signing out ended the session, not just this browser's copy of it: the
    // cookie replayed here is the one that worked a moment ago, and it is
    // refused. `me` above would not notice the difference, because the jar
    // drops a cleared cookie and the client then sends none at all.
    const replayed = await globalThis.fetch(`${baseUrl}/me`, {
      headers: { cookie: cookieBeforeSignOut ?? "" },
    });
    expect(replayed.status).toBe(401);

    // The ballot identity is released too, so this browser can no longer read
    // the vote it cast. That is what stops the next person on a shared machine
    // being handed the previous person's ballot to read and to overwrite.
    expect(await api.myBallot(POLL_ID)).toBeNull();

    // The vote is not withdrawn, only disowned by this browser: it stays
    // counted under the identity that cast it.
    expect((await api.results(POLL_ID)).choices[1]?.count).toBe(1);
  });

  it("does not hand the next person on this browser the last one's ballot", async () => {
    // The whole point of releasing the ballot cookie. Ada votes and signs out;
    // Bo sits down at the same browser.
    await api.requestLink("ada@student.ubc.ca", false);
    await api.redeem(tokenFromLink(mailer.sent[0]?.body ?? ""));
    await api.cast(POLL_ID, [1]);
    await api.signOut();

    await api.requestLink("bo@student.ubc.ca", false);
    await api.redeem(tokenFromLink(mailer.sent[1]?.body ?? ""));

    // Bo is not shown Ada's answer, and Bo's vote is counted rather than
    // silently replacing it. Two voters, one each.
    expect(await api.myBallot(POLL_ID)).toBeNull();
    const outcome = await api.cast(POLL_ID, [0]);
    expect(outcome.status).toBe("counted");

    const results = await api.results(POLL_ID);
    expect(results.voters).toBe(2);
    expect(results.choices[1]?.count).toBe(1);
    expect(results.choices[0]?.count).toBe(1);
  });

  it("changes a vote rather than refusing the second one", async () => {
    await api.requestLink("sam@student.ubc.ca", false);
    await api.redeem(tokenFromLink(mailer.sent[0]?.body ?? ""));

    await api.cast(POLL_ID, [0]);
    const second = await api.cast(POLL_ID, [2]);
    expect(second.status).toBe("changed");
    expect(second.status === "changed" && second.results.voters).toBe(1);
  });

  it("tells someone from an unclaimed domain so, naming the domain", async () => {
    const result = await api.requestLink("someone@gmail.com", false);
    expect(result.status).toBe("not_eligible");
    expect(result.status === "not_eligible" && result.message).toContain(
      "gmail.com",
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it("counts a vote from someone who has never signed in", async () => {
    // The whole point of the opening screen: the vote counts first, and the
    // address someone gives later verifies them rather than letting them vote.
    expect(await api.me()).toBeNull();
    expect(await api.myBallot(POLL_ID)).toBeNull();

    const outcome = await api.cast(POLL_ID, [1]);
    expect(outcome.status).toBe("counted");
    expect(await api.myBallot(POLL_ID)).toEqual([1]);
    expect((await api.results(POLL_ID)).voters).toBe(1);
    expect(await api.me()).toBeNull();
  });

  it("keeps two browsers apart without either of them signing in", async () => {
    const other = new HttpPulseApi(baseUrl, cookieJar().fetch);
    await api.cast(POLL_ID, [0]);
    await other.cast(POLL_ID, [2]);

    expect(await api.myBallot(POLL_ID)).toEqual([0]);
    expect(await other.myBallot(POLL_ID)).toEqual([2]);
    expect((await api.results(POLL_ID)).voters).toBe(2);
  });

  it("adds an option nobody offered, and seconds one somebody had", async () => {
    const first = await api.suggest(SUGGESTS_ID, "Charge the members");
    if (first.status !== "added") throw new Error(first.status);
    expect(first.suggestion.count).toBe(1);

    const again = await api.suggest(SUGGESTS_ID, "we could charge members");
    if (again.status !== "seconded") throw new Error(again.status);
    expect(again.suggestion.text).toBe("Charge the members");
    expect(again.suggestion.count).toBe(2);

    expect((await api.suggestions(SUGGESTS_ID)).map((one) => one.text)).toEqual(
      ["Charge the members"],
    );
  });

  it("points at the poll's own answer instead of adding it twice", async () => {
    const said = await api.suggest(SUGGESTS_ID, "some trees");
    if (said.status !== "on_ballot") throw new Error(said.status);
    expect(said.choice).toEqual({ index: 1, label: "Trees" });
    expect(await api.suggestions(SUGGESTS_ID)).toEqual([]);
  });

  it("reads a poll without anyone being signed in", async () => {
    const poll = await api.poll(POLL_ID);
    expect(poll.choices).toEqual(["Park", "Library", "Rink"]);
    expect(poll.open).toBe(true);
    expect(poll.closesAt).toBeNull();
    // The graph edge, so the client knows where answering takes someone.
    expect(poll.next).toEqual([SUGGESTS_ID, null, null]);
    expect(poll.acceptsSuggestions).toBe(false);
  });
});
