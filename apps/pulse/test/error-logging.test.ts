import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer, type Mailer } from "../src/identity/mailer.js";
import { ResendMailer } from "../src/identity/resend-mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { createServer } from "../src/http/server.js";
import { SessionSigner } from "../src/http/session.js";
import { SERVED_LOGGER } from "../src/main.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { sendOriginLikeABrowser } from "./support/origin.js";

const WEB_ORIGIN = "https://pulse.test";
const PRIVATE = "private-person@example.test";
const MESSAGE = `unexpected failure involving ${PRIVATE}`;

async function harness(t: TestContext, fault?: unknown, mailer?: Mailer) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const voters = new InMemoryVoterStore();
  const claims = new ClaimService({
    membership: new DomainAllowlist(new StaticDomainSource([])),
    voters,
    claims: new InMemoryClaimStore(),
    mailer: mailer ?? new ConsoleMailer(() => {}),
    linkFor: (token) => `https://pulse.test/sign-in?token=${token}`,
  });
  const votes = new InMemoryVotingStore();
  if (fault !== undefined)
    votes.getPoll = async () => {
      throw fault;
    };
  const app = await createServer({
    claims,
    voters,
    votes,
    suggestions: new InMemorySuggestionStore(),
    signer: new SessionSigner("test-secret-that-is-long-enough-x"),
    webOrigin: WEB_ORIGIN,
    logger: { ...SERVED_LOGGER, level: "info", stream },
  });
  t.after(() => app.close());
  return { app: sendOriginLikeABrowser(app, WEB_ORIGIN), lines };
}

for (const code of [undefined, "23505", `not-a-sqlstate-${PRIVATE}`]) {
  test(`unexpected_API_fault_logs_only_kind_and_valid_SQLSTATE_${code ?? "none"}`, async (t) => {
    const fault = Object.assign(new TypeError(MESSAGE), {
      detail: `Key email=${PRIVATE}`,
      code,
      cause: new Error(PRIVATE),
    });
    const h = await harness(t, fault);
    const response = await h.app.inject({
      method: "GET",
      url: "/api/polls/missing",
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: "server_error",
      message: "Something went wrong. Try again.",
    });
    const logs = h.lines.join("");
    assert.doesNotMatch(
      logs,
      /private-person@example\.test|unexpected failure|Key email/,
    );
    const logged = h.lines
      .map((line) => JSON.parse(line) as { fault?: unknown })
      .find((line) => line.fault);
    assert.deepEqual(logged?.fault, {
      type: "TypeError",
      ...(code === "23505" ? { code } : {}),
    });
  });
}

test("a_mutable_error_name_cannot_smuggle_personal_data_into_logs", async (t) => {
  const fault = new Error(MESSAGE);
  fault.name = PRIVATE;
  const h = await harness(t, fault);
  assert.equal((await h.app.inject("/api/polls/missing")).statusCode, 500);
  assert.doesNotMatch(h.lines.join(""), /private-person@example\.test/);
  assert.match(h.lines.join(""), /"type":"Error"/);
});

test("mail_provider_rejection_logs_its_status_without_response_text_or_recipient", async (t) => {
  const mailer = new ResendMailer(
    { apiKey: "private-api-key", from: "pulse@example.test" },
    {
      fetch: async () =>
        new Response(`provider rejected ${PRIVATE} with secret-response`, {
          status: 422,
        }),
    },
  );
  const h = await harness(t, undefined, mailer);
  const response = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: PRIVATE },
  });
  assert.equal(response.statusCode, 500);
  const logs = h.lines.join("");
  assert.doesNotMatch(
    logs,
    /private-person@example\.test|secret-response|private-api-key|provider rejected/,
  );
  assert.match(logs, /"status":422/);
});

test("planned_bad_requests_still_answer_without_an_error_log", async (t) => {
  const h = await harness(t);
  const response = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: "bad_request",
    message: "That request could not be read.",
  });
  assert.equal(
    h.lines
      .map((line) => JSON.parse(line) as { level: number })
      .some((line) => line.level >= 50),
    false,
  );
});

test("transient_mail_failure_default_console_sink_keeps_status_without_provider_text", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const mailer = new ResendMailer(
    { apiKey: "private-api-key", from: "pulse@example.test" },
    {
      fetch: async () =>
        new Response(`provider refused ${PRIVATE} secret-response`, {
          status: 503,
        }),
    },
  );
  const h = await harness(t, undefined, mailer);
  const response = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: PRIVATE },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0], [
    "pulse: a sign-in link could not be sent",
    { type: "MailSendError", status: 503 },
  ]);
  assert.doesNotMatch(
    JSON.stringify(logged) + h.lines.join(""),
    /private-person@example\.test|secret-response|private-api-key|provider refused/,
  );
});
