import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The server, imported by path rather than as a package: pulse is one epic in
// two workspace packages, `@odc/pulse` publishes no build artefacts, and this
// is the one place that needs both halves at once. Nothing in `src/` imports
// across — only this proof does.
import {
  ClaimService,
  ConsoleMailer,
  DomainAllowlist,
  InMemoryClaimStore,
  InMemoryVoterStore,
  InMemoryVotingStore,
  SessionSigner,
  StaticDomainSource,
  createServer,
} from "../../pulse/src/index.js";
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

/** A cookie jar around global fetch, which is the one thing Node lacks. */
function installCookieJar(): () => void {
  const jar = new Map<string, string>();
  const real = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.size > 0) {
      headers.set(
        "cookie",
        [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const response = await real(input, { ...init, headers });
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

  return () => {
    globalThis.fetch = real;
  };
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
  let restoreFetch: () => void;

  beforeEach(async () => {
    mailer = new ConsoleMailer(() => {});
    const voters = new InMemoryVoterStore();
    const votes = new InMemoryVotingStore();
    await votes.createPoll({
      id: POLL_ID,
      question: "Where should the next one be?",
      choices: ["Park", "Library", "Rink"],
      method: "single",
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
      signer: new SessionSigner("a-test-secret-long-enough"),
      secureCookies: false,
    });

    // Port 0: the OS picks a free one, so parallel test files never collide.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    restoreFetch = installCookieJar();
    api = new HttpPulseApi(`http://127.0.0.1:${port}/api`);
  });

  afterEach(async () => {
    restoreFetch();
    await app.close();
  });

  it("signs a member in from an emailed link, votes, and signs out again", async () => {
    expect(await api.me()).toBeNull();

    expect(await api.requestLink("jo@student.ubc.ca", true)).toEqual({
      status: "sent",
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

    await api.signOut();
    expect(await api.me()).toBeNull();

    // Signed out, but the vote stays counted.
    expect((await api.results(POLL_ID)).choices[1]?.count).toBe(1);
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

  it("reads a poll without anyone being signed in", async () => {
    const poll = await api.poll(POLL_ID);
    expect(poll.choices).toEqual(["Park", "Library", "Rink"]);
    expect(poll.open).toBe(true);
    expect(poll.closesAt).toBeNull();
  });
});
