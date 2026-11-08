// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { createServer } from "../../../apps/pulse/src/http/server.js";
import { SessionSigner } from "../../../apps/pulse/src/http/session.js";
import { ClaimService } from "../../../apps/pulse/src/identity/claim.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../../../apps/pulse/src/identity/allowlist.js";
import { ConsoleMailer } from "../../../apps/pulse/src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../../../apps/pulse/src/identity/store.js";
import { InMemoryVotingStore } from "../../../apps/pulse/src/voting/store.js";
import { InMemorySuggestionStore } from "../../../apps/pulse/src/voting/suggestions.js";
import { HttpPulseApi } from "../../../apps/pulse-web/src/api/http.js";
import { App } from "../../../apps/pulse-web/src/App.js";

// ResultsPanel lazy-loads the chart; load its module up front so a cold
// test run does not outwait findBy's default timeout transforming Recharts.
beforeAll(() => import("../../../apps/pulse-web/src/components/BarChart.js"));

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
});

/** One browser: its own cookie jar against the shared server. */
function browser(base: string) {
  let cookie = "";
  const request: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(input, { ...init, headers });
    const set = response.headers.getSetCookie();
    if (set.length) cookie = set.map((value) => value.split(";")[0]).join("; ");
    return response;
  };
  return new HttpPulseApi(base, request);
}

it("My votes lists this browser's saved answers over the real HTTP API, and only its own", async () => {
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  await votes.createPoll({
    id: "parks",
    question: "More parks?",
    choices: ["No", "Yes"],
    method: "single",
  });
  await votes.createPoll({
    id: "fixes",
    question: "Which improvements?",
    choices: ["Park", "Library", "Rink"],
    method: "approval",
    closesAt: new Date(Date.now() + 60_000),
  });
  const app = await createServer({
    voters,
    votes,
    suggestions: new InMemorySuggestionStore(),
    signer: new SessionSigner("my-votes-test-secret-long-enough"),
    secureCookies: false,
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `http://localhost/sign-in?token=${token}`,
    }),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const mine = browser(base);
    await mine.cast("parks", [1]);
    await mine.cast("fixes", [2, 0]);
    const first = render(<App api={mine} route={{ kind: "myVotes" }} />);
    expect(await screen.findByText("Your answer: Park, Rink")).toBeTruthy();
    expect(screen.getByText("Your answer: Yes")).toBeTruthy();
    const page = await mine.myVotes();
    expect(page.votes.map((vote) => vote.ballot)).toEqual([[0, 2], [1]]);
    first.unmount();

    // A second browser has no ballot cookie, so it owns no votes.
    render(<App api={browser(base)} route={{ kind: "myVotes" }} />);
    expect(
      await screen.findByText("No votes saved in this browser yet."),
    ).toBeTruthy();
  } finally {
    await app.close();
  }
});

it("the Answered list and the saved answer survive a reload over the real HTTP API (#484)", async () => {
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  await votes.createPoll({
    id: "parks",
    question: "More parks?",
    choices: ["No", "Yes"],
    method: "single",
  });
  await votes.createPoll({
    id: "rinks",
    question: "A new rink?",
    choices: ["No", "Yes"],
    method: "single",
  });
  const app = await createServer({
    voters,
    votes,
    suggestions: new InMemorySuggestionStore(),
    signer: new SessionSigner("answered-test-secret-long-enough"),
    secureCookies: false,
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `http://localhost/sign-in?token=${token}`,
    }),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const mine = browser(base);
    await mine.cast("rinks", [0]);
    await mine.cast("parks", [1]);
    const route = { kind: "conversation", pollId: "parks" } as const;

    // A fresh page, as after a reload: the answer and the list come back.
    const first = render(<App api={mine} route={route} />);
    const main = within(await screen.findByRole("main"));
    expect(await main.findByText("You picked Yes.")).toBeTruthy();
    const rail = within(screen.getByRole("navigation", { name: "Answered" }));
    expect(
      (await rail.findAllByRole("link")).map((link) => link.textContent),
    ).toEqual(["More parks?", "A new rink?"]);
    first.unmount();

    // Changed from elsewhere in this browser: the next page shows the change.
    await mine.cast("rinks", [1]);
    render(<App api={mine} route={route} />);
    const again = within(
      await screen.findByRole("navigation", { name: "Answered" }),
    );
    expect(await again.findAllByText("Your answer: Yes")).toHaveLength(2);
    expect(again.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "A new rink?",
      "More parks?",
    ]);
  } finally {
    await app.close();
  }
});
