import assert from "node:assert/strict";
import { test } from "node:test";
import { MailRejectedError, MailSendError } from "../src/identity/mailer.js";
import {
  DEFAULT_TIMEOUT_MS,
  ResendMailer,
  resendConfig,
  type ResendConfig,
} from "../src/identity/resend-mailer.js";

const CONFIG: ResendConfig = {
  apiKey: "re_test_key",
  from: "pulse <sign-in@pulse.test>",
};

const ENDPOINT = "https://api.resend.test/emails";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A mailer whose provider answers however the test says, recording each call. */
function setup(
  answer: (call: Call) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ id: "sent-1" }), { status: 200 }),
) {
  const calls: Call[] = [];
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    calls.push(call);
    return answer(call);
  };

  return {
    calls,
    mailer: new ResendMailer(CONFIG, { fetch: fetchStub, endpoint: ENDPOINT }),
    only(): Call {
      assert.equal(calls.length, 1, "expected exactly one request");
      return calls[0] as Call;
    },
  };
}

test("a_sign_in_link_is_posted_to_the_provider_with_the_key_and_the_sender", async () => {
  const h = setup();
  await h.mailer.sendClaimLink(
    "ada@pulse.test",
    "https://pulse.test/sign-in?token=abc",
  );

  const call = h.only();
  assert.equal(call.url, ENDPOINT);
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["authorization"], "Bearer re_test_key");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(call.body["from"], CONFIG.from);
  // An array, which is the shape Resend takes. A bare string is accepted today
  // and the plural field is the one that stays right if pulse ever sends to two.
  assert.deepEqual(call.body["to"], ["ada@pulse.test"]);
  assert.equal(typeof call.body["subject"], "string");
  assert.notEqual(call.body["subject"], "");
});

test("with_nothing_overridden_it_posts_to_resend_and_carries_a_timeout", async () => {
  // Every other test injects an endpoint and a timeout, so without this one the
  // real URL is never exercised and the default timeout can be changed to an
  // hour with the suite still green — the held-open sign-in request the
  // constant exists to prevent.
  const calls: { url: string; init: RequestInit }[] = [];
  const mailer = new ResendMailer(CONFIG, {
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    },
  });
  await mailer.sendClaimLink("ada@pulse.test", "https://pulse.test/x");

  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.ok(
    calls[0]?.init.signal instanceof AbortSignal,
    "the request must carry an abort signal",
  );
});

test("the_default_timeout_stays_short_enough_that_nobody_waits_on_a_dead_provider", () => {
  // Somebody is in front of a spinner for this whole duration, having just
  // pressed the only button on the screen. Ten seconds is a judgement call;
  // ten minutes is not a timeout at all, and raising it is exactly the kind of
  // edit that looks harmless in a diff.
  //
  // The bound is asserted rather than the number, because a test that waited
  // the real default out would add that wait to every run. The limit of this:
  // it pins the constant, not the `??` that reads it — the abort-signal test
  // above covers the wiring.
  assert.ok(
    DEFAULT_TIMEOUT_MS <= 30_000,
    `a sign-in must not hang for ${DEFAULT_TIMEOUT_MS}ms`,
  );
  assert.ok(
    DEFAULT_TIMEOUT_MS >= 1_000,
    `${DEFAULT_TIMEOUT_MS}ms would abandon a merely slow provider`,
  );
});

test("a_very_long_refusal_is_truncated_before_it_becomes_an_error_message", async () => {
  // Providers answer with HTML error pages. Without the cap the whole page ends
  // up in one log line.
  const h = setup(() => new Response("x".repeat(5000), { status: 500 }));

  const error = await h.mailer
    .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
    .then(
      () => undefined,
      (err: unknown) => err,
    );

  assert.ok(error instanceof MailSendError);
  assert.ok(
    error.message.length < 700,
    `expected a truncated message, got ${error.message.length} characters`,
  );
});

test("the_link_is_in_the_text_part_as_well_as_the_html_one", async () => {
  // A mail client that strips the anchor, or a person forwarding this to the
  // device they actually read on, still needs something to click or paste.
  const h = setup();
  const link = "https://pulse.test/sign-in?token=abc";
  await h.mailer.sendClaimLink("ada@pulse.test", link);

  const call = h.only();
  assert.match(
    String(call.body["text"]),
    /https:\/\/pulse\.test\/sign-in\?token=abc/,
  );
  assert.match(
    String(call.body["html"]),
    /href="https:\/\/pulse\.test\/sign-in\?token=abc"/,
  );
});

test("a_link_carrying_an_ampersand_is_escaped_in_the_html_and_left_alone_in_the_text", async () => {
  // `linkFor` is a caller-supplied builder and a second query parameter is one
  // edit away. A raw `&` in an href is what silently truncates a token.
  const h = setup();
  const link = "https://pulse.test/sign-in?token=abc&from=email";
  await h.mailer.sendClaimLink("ada@pulse.test", link);

  const call = h.only();
  assert.match(String(call.body["html"]), /token=abc&amp;from=email/);
  assert.doesNotMatch(String(call.body["html"]), /token=abc&from=email/);
  assert.match(String(call.body["text"]), /token=abc&from=email/);
});

test("a_link_carrying_a_quote_cannot_break_out_of_the_href_attribute", async () => {
  // The link goes into a double-quoted attribute, so the quote is the one
  // escape that decides whether a value stays inside it. `linkFor` builds a
  // base64url token today and nothing hostile can reach this, which makes the
  // guard cheap insurance — not something to leave unpinned.
  const h = setup();
  await h.mailer.sendClaimLink(
    "ada@pulse.test",
    'https://pulse.test/sign-in?token=a"b',
  );

  const html = String(h.only().body["html"]);
  assert.match(html, /token=a&quot;b/);
  assert.doesNotMatch(html, /token=a"b/);
});

test("a_proof_of_action_body_is_escaped_before_it_becomes_markup", async () => {
  // The body is prose from elsewhere in pulse. Nothing in it may be read as a
  // tag, however it was written.
  const h = setup();
  await h.mailer.sendProofOfAction(
    "ada@pulse.test",
    "What happened",
    "The <script> vote closed & the money went out.",
  );

  const call = h.only();
  const html = String(call.body["html"]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  // The text part is the prose exactly as written.
  assert.equal(
    call.body["text"],
    "The <script> vote closed & the money went out.",
  );
});

test("a_reply_to_is_sent_only_when_one_is_configured", async () => {
  const without = setup();
  await without.mailer.sendClaimLink("ada@pulse.test", "https://pulse.test/x");
  assert.equal("reply_to" in without.only().body, false);

  const calls: Call[] = [];
  const withReplyTo = new ResendMailer(
    { ...CONFIG, replyTo: "hello@pulse.test" },
    {
      endpoint: ENDPOINT,
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          init: init ?? {},
          body: JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >,
        });
        return new Response("{}", { status: 200 });
      },
    },
  );
  await withReplyTo.sendClaimLink("ada@pulse.test", "https://pulse.test/x");
  assert.equal(calls[0]?.body["reply_to"], "hello@pulse.test");
});

test("a_refusal_keeps_the_providers_own_words_for_whoever_reads_the_log", async () => {
  const h = setup(
    () =>
      new Response(JSON.stringify({ message: "domain is not verified" }), {
        status: 422,
      }),
  );

  const error = await h.mailer
    .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
    .then(
      () => undefined,
      (err: unknown) => err,
    );

  assert.ok(error instanceof Error);
  // An operator reading this needs to know it was the sending domain and not
  // the address. Nobody signing in ever sees it.
  assert.match(error.message, /domain is not verified/);
  assert.match(error.message, /422/);
});

test("a_refusal_that_repeating_cannot_fix_is_a_fault_rather_than_an_outage", async () => {
  // A revoked key, an unverified sending domain, a malformed payload. Answering
  // these as "try again" would tell every person to retry forever while
  // ADR-0027 instructs the operator not to alert on them — silent permanent
  // breakage, reached from the other side.
  for (const status of [400, 401, 403, 404, 422]) {
    const h = setup(() => new Response("nope", { status }));
    const error = await h.mailer
      .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    assert.ok(
      error instanceof MailRejectedError,
      `${status} should be a rejection`,
    );
    // Not a MailSendError, which is what keeps it on its 500.
    assert.equal(error instanceof MailSendError, false);
    assert.equal(error.status, status);
  }
});

test("a_provider_that_is_busy_or_broken_is_an_outage_worth_retrying", async () => {
  for (const status of [408, 429, 500, 502, 503]) {
    const h = setup(() => new Response("later", { status }));
    const error = await h.mailer
      .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    assert.ok(error instanceof MailSendError, `${status} should be retryable`);
    assert.equal(error.status, status);
  }
});

test("a_provider_that_cannot_be_reached_raises_MailSendError_rather_than_the_raw_failure", async () => {
  // A refused connection, a DNS failure, the request timing out. None of them
  // is a fault in pulse, so none may reach the 500 handler.
  const cause = new Error("ECONNREFUSED");
  const mailer = new ResendMailer(CONFIG, {
    endpoint: ENDPOINT,
    fetch: async () => {
      throw cause;
    },
  });

  const error = await mailer
    .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
    .then(
      () => undefined,
      (err: unknown) => err,
    );

  assert.ok(error instanceof MailSendError, "expected a MailSendError");
  assert.equal(error.status, undefined);
  assert.equal(error.cause, cause);
});

test("a_refusal_whose_body_cannot_be_read_still_raises_the_refusal", async () => {
  // Failing to read the explanation must not replace the error with a
  // different one, which is how a 500 ends up on a screen instead of a 503.
  const h = setup(() => {
    const response = new Response("", { status: 500 });
    Object.defineProperty(response, "text", {
      value: () => Promise.reject(new Error("stream already consumed")),
    });
    return response;
  });

  const error = await h.mailer
    .sendClaimLink("ada@pulse.test", "https://pulse.test/x")
    .then(
      () => undefined,
      (err: unknown) => err,
    );

  assert.ok(error instanceof MailSendError, "expected a MailSendError");
  assert.equal(error.status, 500);
});

test("a_send_that_takes_too_long_is_abandoned_rather_than_held_open", async () => {
  // Without the timeout, a provider that accepts the connection and then says
  // nothing holds the sign-in request open for as long as it likes.
  const mailer = new ResendMailer(CONFIG, {
    endpoint: ENDPOINT,
    timeoutMs: 5,
    fetch: (_input, init) =>
      new Promise((resolve, reject) => {
        // This settles on its own if the abort never comes, so dropping the
        // signal from the request makes this test FAIL rather than hang — and
        // the timer is ref'd, which also holds the loop open for the wait.
        // `AbortSignal.timeout` schedules an unref'd timer, so with nothing
        // else pending the loop would drain before it could ever fire.
        const answersLate = setTimeout(() => {
          resolve(new Response("{}", { status: 200 }));
        }, 500);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(answersLate);
          reject(new Error("aborted"));
        });
      }),
  });

  await assert.rejects(
    mailer.sendClaimLink("ada@pulse.test", "https://pulse.test/x"),
    MailSendError,
  );
});

test("no_key_means_no_provider_is_configured", () => {
  assert.equal(resendConfig({}), undefined);
  // Empty and whitespace-only are unset, exactly as for the database URL: all
  // three of them mean the same thing to the person who typed them.
  assert.equal(resendConfig({ PULSE_RESEND_API_KEY: "" }), undefined);
  assert.equal(resendConfig({ PULSE_RESEND_API_KEY: "   " }), undefined);
});

test("a_key_without_a_sender_refuses_to_start_rather_than_failing_at_the_first_sign_in", () => {
  // The person who would see the failure is not the person who set the
  // variable, so it has to be said at startup.
  assert.throws(
    () => resendConfig({ PULSE_RESEND_API_KEY: "re_k" }),
    /PULSE_MAIL_FROM/,
  );
  assert.throws(
    () => resendConfig({ PULSE_RESEND_API_KEY: "re_k", PULSE_MAIL_FROM: "  " }),
    /PULSE_MAIL_FROM/,
  );
});

test("a_key_and_a_sender_are_read_and_trimmed", () => {
  assert.deepEqual(
    resendConfig({
      PULSE_RESEND_API_KEY: " re_k ",
      PULSE_MAIL_FROM: " pulse <sign-in@pulse.test> ",
    }),
    { apiKey: "re_k", from: "pulse <sign-in@pulse.test>" },
  );
  assert.deepEqual(
    resendConfig({
      PULSE_RESEND_API_KEY: "re_k",
      PULSE_MAIL_FROM: "pulse <sign-in@pulse.test>",
      PULSE_MAIL_REPLY_TO: "hello@pulse.test",
    }),
    {
      apiKey: "re_k",
      from: "pulse <sign-in@pulse.test>",
      replyTo: "hello@pulse.test",
    },
  );
});
