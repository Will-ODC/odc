// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
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

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
});
it("approval cast, replacement, network retry and closed results work over the real HTTP API", async () => {
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  await votes.createPoll({
    id: "ads-free",
    next: [null, "approval"],
    question: "Stay free of ads?",
    choices: ["No", "Yes"],
    method: "single",
  });
  await votes.createPoll({
    id: "approval",
    question: "Which improvements?",
    choices: ["Park", "Library", "Rink"],
    method: "approval",
    next: [null, null, null],
  });
  await votes.createPoll({
    id: "closed",
    question: "An ended question",
    choices: ["No", "Yes"],
    method: "single",
    closesAt: new Date(Date.now() - 1000),
  });
  const app = await createServer({
    voters,
    votes,
    suggestions: new InMemorySuggestionStore(),
    signer: new SessionSigner("conversation-test-secret-long-enough"),
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
  let cookie = "";
  let fail = false;
  const request: typeof fetch = async (input, init) => {
    if (fail && init?.method === "POST") {
      fail = false;
      throw new Error("Network unavailable");
    }
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(input, { ...init, headers });
    const set = response.headers.getSetCookie();
    if (set.length) cookie = set.map((value) => value.split(";")[0]).join("; ");
    return response;
  };
  const api = new HttpPulseApi(`http://127.0.0.1:${address.port}/api`, request);
  try {
    globalThis.history.replaceState(null, "", "/");
    const first = render(<App api={api} firstPollId="ads-free" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start voting" }));
    await user.click(
      screen.getByRole("button", { name: "Help choose what comes next" }),
    );
    await user.click(
      screen.getByRole("button", { name: "How should the voting page look?" }),
    );
    await screen.findByRole("heading", { name: "Stay free of ads?", level: 1 });
    await user.click(
      await screen.findByRole("button", { name: "Show me how" }),
    );
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Counted");
    expect(await api.myBallot("ads-free")).toEqual([1]);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", {
      name: "Which improvements?",
      level: 1,
    });
    let card = within(screen.getByRole("region"));
    expect(card.getByRole("button", { name: "Submit" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(await api.myBallot("approval")).toBeNull();
    await user.click(card.getByRole("checkbox", { name: "Park" }));
    await user.click(card.getByRole("checkbox", { name: "Rink" }));
    await user.click(card.getByRole("button", { name: "Submit" }));
    await screen.findByText("Counted");
    expect(await api.myBallot("approval")).toEqual([0, 2]);
    expect(card.getAllByText("yours")).toHaveLength(2);
    await user.click(card.getByRole("button", { name: "Change my answer" }));
    await user.click(card.getByRole("checkbox", { name: "Park" }));
    fail = true;
    await user.click(card.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Check your connection"),
    );
    await user.click(card.getByRole("button", { name: "Try again" }));
    await screen.findByText("Counted. That replaces your earlier answer.");
    expect(await api.myBallot("approval")).toEqual([2]);
    expect((await api.results("approval")).voters).toBe(1);
    first.unmount();
    globalThis.history.replaceState(null, "", "/?poll=closed");
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "An ended question", level: 1 });
    await screen.findByText("This one has closed.");
    card = within(screen.getByRole("region"));
    expect(card.queryByRole("button", { name: "Submit" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "See results" }));
    await screen.findByText("Nobody answered this one.");
  } finally {
    cleanup();
    await app.close();
  }
});
