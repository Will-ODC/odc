import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryContributionsStore } from "../../../apps/pulse/src/contributions/memory-store.js";
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
import { InMemorySuggestionStore } from "../../../apps/pulse/src/voting/suggestions.js";
import { InMemoryVotingStore } from "../../../apps/pulse/src/voting/store.js";
import { createServer } from "../../../apps/pulse/src/http/server.js";
import { SessionSigner } from "../../../apps/pulse/src/http/session.js";
import { HttpPulseApi } from "../../../apps/pulse-web/src/api/http.js";
import {
  HttpContributionsApi,
  type ContributionInput,
} from "../../../apps/pulse-web/src/api/contributions.js";

const WEB_ORIGIN = "http://localhost:5173";
type PulseServer = Awaited<ReturnType<typeof createServer>>;

// Supply the origin and cookie behavior a browser provides, using a real socket.
function browserFetch(origin: string): typeof fetch {
  const cookies = new Map<string, string>();
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", WEB_ORIGIN);
    if (cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const response = await fetch(new URL(String(input), origin), {
      ...init,
      headers,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === "") cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  };
}

const project: ContributionInput = {
  title: "Make the park accessible",
  description: "Survey the entrances and publish a practical access plan.",
  communityBenefit: "Neighbours using mobility aids can reach the park.",
  needs: "Two volunteers to measure entrances.",
  kind: "project",
  organizerName: "Park group",
};

describe("Contributions through the browser HTTP adapter", () => {
  let app: PulseServer;
  let mailer: ConsoleMailer;
  let origin: string;

  beforeEach(async () => {
    mailer = new ConsoleMailer(() => {});
    const voters = new InMemoryVoterStore();
    const votes = new InMemoryVotingStore();
    app = await createServer({
      claims: new ClaimService({
        membership: new DomainAllowlist(new StaticDomainSource([])),
        voters,
        claims: new InMemoryClaimStore(),
        mailer,
        linkFor: (token) =>
          `${WEB_ORIGIN}/sign-in?token=${encodeURIComponent(token)}`,
      }),
      voters,
      votes,
      suggestions: new InMemorySuggestionStore(),
      contributions: new InMemoryContributionsStore(voters, votes),
      signer: new SessionSigner("contributions-http-test-secret-long-enough"),
      webOrigin: WEB_ORIGIN,
      secureCookies: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string) {
    const doFetch = browserFetch(origin);
    const identity = new HttpPulseApi(`${origin}/api`, doFetch);
    await identity.requestLink(email, false);
    const token = new URL(mailer.lastTo(email)?.body ?? "").searchParams.get(
      "token",
    );
    const account = await identity.redeem(token ?? "");
    return { api: new HttpContributionsApi(doFetch), identity, account };
  }

  it("publishes, discovers, offers help and reports progress without exposing account identity", async () => {
    const owner = await signIn("organizer@example.test");
    const member = await signIn("helper@example.test");
    const guest = new HttpContributionsApi(browserFetch(origin));
    const key = randomUUID();
    const created = await owner.api.create(project, key);
    expect(await owner.api.create(project, key)).toEqual(created);
    expect((await guest.list()).contributions.map((item) => item.id)).toEqual([
      created.id,
    ]);
    expect((await owner.api.detail(created.id)).canManage).toBe(true);
    expect((await member.api.detail(created.id)).canManage).toBe(false);
    expect((await guest.detail(created.id)).canManage).toBe(false);

    const help = {
      displayName: "Sam",
      kind: "help" as const,
      message: "I can measure the north entrance on Saturday.",
    };
    const helpKey = randomUUID();
    const joined = await member.api.participate(created.id, help, helpKey);
    expect(joined.participations).toHaveLength(1);
    expect(joined.participations[0]).toMatchObject(help);
    expect(await member.api.participate(created.id, help, helpKey)).toEqual(
      joined,
    );

    const progress = {
      message: "Entrance measurements are published for review.",
      status: "completed" as const,
      evidenceUrl: "https://example.test/park-survey",
    };
    await expect(
      member.api.update(created.id, progress, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    const updateKey = randomUUID();
    const completed = await owner.api.update(created.id, progress, updateKey);
    expect(completed.status).toBe("completed");
    expect(completed.updates).toHaveLength(1);
    expect(completed.updates[0]).toMatchObject(progress);
    expect(await owner.api.update(created.id, progress, updateKey)).toEqual(
      completed,
    );
    // A saved participation still replays after the project closes.
    expect(await member.api.participate(created.id, help, helpKey)).toEqual(
      joined,
    );
    await expect(
      member.api.participate(created.id, help, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    const publicRecord = await guest.detail(created.id);
    expect(publicRecord.contribution.status).toBe("completed");
    const serialized = JSON.stringify(publicRecord);
    for (const privateValue of [
      owner.account.id,
      member.account.id,
      "organizer@example.test",
      "helper@example.test",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("requires sign-in and rejects changed retries without making another record", async () => {
    const guest = new HttpContributionsApi(browserFetch(origin));
    await expect(guest.create(project, randomUUID())).rejects.toMatchObject({
      status: 401,
    });
    const owner = await signIn("organizer@example.test");
    const key = randomUUID();
    const created = await owner.api.create(project, key);
    await expect(
      owner.api.create({ ...project, title: "Changed request" }, key),
    ).rejects.toMatchObject({ status: 409 });
    expect((await guest.list()).contributions.map((item) => item.id)).toEqual([
      created.id,
    ]);
    await owner.identity.signOut();
    await expect(
      owner.api.update(
        created.id,
        { message: "Closed", status: "cancelled" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect((await guest.detail(created.id)).contribution.status).toBe("open");
  });

  it("enforces the advertised savings threshold and carries a declared fund share", async () => {
    const owner = await signIn("organizer@example.test");
    const commercial = {
      currency: "CAD",
      regularPriceMinor: 10000,
      offeredPriceMinor: 8001,
      referenceUrl: "https://example.test/regular-price",
      terms: "Same product and delivery, with all mandatory charges included.",
    };
    const offer: ContributionInput = {
      ...project,
      title: "Community tool group buy",
      kind: "group_buy",
      commercial,
      fund: { name: "Community repair fund", percentage: 5 },
    };
    await expect(owner.api.create(offer, randomUUID())).rejects.toMatchObject({
      status: 400,
    });
    const created = await owner.api.create(
      { ...offer, commercial: { ...commercial, offeredPriceMinor: 8000 } },
      randomUUID(),
    );
    const read = await new HttpContributionsApi(browserFetch(origin)).detail(
      created.id,
    );
    expect(read.contribution.commercial).toEqual({
      ...commercial,
      offeredPriceMinor: 8000,
    });
    expect(read.contribution.fund).toEqual({
      name: "Community repair fund",
      percentage: 5,
    });
    expect((await owner.api.list()).contributions).toHaveLength(1);
  });
});
