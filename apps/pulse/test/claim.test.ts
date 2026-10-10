import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import {
  ClaimService,
  hashToken,
  type ClaimOptions,
} from "../src/identity/claim.js";
import {
  ConsoleMailer,
  MailSendError,
  type Mailer,
} from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";

const START = new Date("2026-08-09T12:00:00.000Z");

/** A service wired to one community, a silent mailer, and a movable clock. */
function setup(
  options: ClaimOptions = {},
  overrides: { mailer?: Mailer } = {},
) {
  let now = START;
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
  const claims = new InMemoryClaimStore();
  let issued = 0;

  const service = new ClaimService(
    {
      membership: new DomainAllowlist(
        new StaticDomainSource([
          { community: "ubc-students", domain: "student.ubc.ca" },
        ]),
      ),
      voters,
      claims,
      // The override is what a test uses to make sending fail; `mailer`
      // stays the console one so the helpers below can still read what was sent.
      mailer: overrides.mailer ?? mailer,
      linkFor: (token) => `https://pulse.test/claim?token=${token}`,
    },
    {
      clock: () => now,
      newToken: () => `token-${++issued}`,
      ...options,
    },
  );

  return {
    service,
    mailer,
    voters,
    claims,
    at(when: Date) {
      now = when;
    },
    after(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    /** The token out of the last link that was mailed. */
    lastToken(address: string): string {
      const message = mailer.lastTo(address);
      assert.ok(message, `nothing was sent to ${address}`);
      return new URL(message.body).searchParams.get("token") as string;
    },
  };
}

test("two_clicks_on_one_link_sign_in_once_and_the_other_hears_it_was_used", async () => {
  // A double click, or a mail scanner racing the person. Unless spending a
  // link is one step, both requests read it as unused before either marks it.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");

  const results = await Promise.all([
    h.service.redeem(token),
    h.service.redeem(token),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "already_used",
    "signed_in",
  ]);
});

test("two_links_for_one_address_redeemed_at_once_are_one_voter", async () => {
  // Two requests leave two live links. Clicking both at once must not make
  // two voters — nor fail the slower click on one-voter-per-address.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const first = h.lastToken("ada@student.ubc.ca");
  await h.service.requestLink("ada@student.ubc.ca");
  const second = h.lastToken("ada@student.ubc.ca");
  assert.notEqual(first, second);

  const results = await Promise.all([
    h.service.redeem(first),
    h.service.redeem(second),
  ]);
  const signedIn = results.flatMap((result) =>
    result.status === "signed_in" ? [result] : [],
  );
  assert.equal(signedIn.length, 2);
  assert.equal(new Set(signedIn.map((result) => result.voter.id)).size, 1);
  assert.deepEqual(signedIn.map((result) => result.firstTime).sort(), [
    false,
    true,
  ]);
});

test("sends_a_link_to_a_member_and_signs_them_in_when_clicked", async () => {
  const h = setup();
  const requested = await h.service.requestLink("Ada@student.ubc.ca");
  assert.equal(requested.status, "sent");

  const redeemed = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(redeemed.status, "signed_in");
  if (redeemed.status !== "signed_in") return;
  assert.equal(redeemed.firstTime, true);
  assert.equal(redeemed.voter.email, "ada@student.ubc.ca");
  assert.equal(redeemed.voter.community, "ubc-students");
});

test("the_same_address_signs_back_in_as_the_same_voter", async () => {
  // The id is what votes are counted against, so a second sign-in must not
  // mint a second identity for one person.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const first = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));

  await h.service.requestLink("ADA@student.ubc.ca");
  const second = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));

  assert.equal(
    first.status === "signed_in" && second.status === "signed_in",
    true,
  );
  if (first.status !== "signed_in" || second.status !== "signed_in") return;
  assert.equal(second.voter.id, first.voter.id);
  assert.equal(second.firstTime, false);
});

test("a_link_works_exactly_once", async () => {
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");

  assert.equal((await h.service.redeem(token)).status, "signed_in");
  assert.equal((await h.service.redeem(token)).status, "already_used");
});

test("a_link_stops_working_once_it_expires", async () => {
  const h = setup({ linkTtlMs: 60_000 });
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");

  h.after(60_001);
  assert.equal((await h.service.redeem(token)).status, "expired");
});

test("a_link_still_works_a_moment_before_it_expires", async () => {
  const h = setup({ linkTtlMs: 60_000 });
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");

  h.after(59_999);
  assert.equal((await h.service.redeem(token)).status, "signed_in");
});

test("a_token_that_was_never_issued_signs_nobody_in", async () => {
  const h = setup();
  assert.equal((await h.service.redeem("made-up")).status, "unknown_link");
  assert.equal((await h.service.redeem("")).status, "unknown_link");
});

test("signs_in_an_address_from_a_domain_no_community_claimed_with_no_community", async () => {
  // ADR-0030: the allowlist is a label, not a gate. An address that matches no
  // row is sent a link like anyone else and signs in with community null —
  // null, not "" and not a placeholder, from the claim through to the voter.
  const h = setup();
  const result = await h.service.requestLink("someone@gmail.com");
  assert.equal(result.status, "sent");
  assert.equal(h.mailer.sent.length, 1);

  const token = h.lastToken("someone@gmail.com");
  const claim = await h.claims.byTokenHash(hashToken(token));
  assert.equal(claim?.community, null);

  const redeemed = await h.service.redeem(token);
  assert.equal(redeemed.status, "signed_in");
  if (redeemed.status !== "signed_in") return;
  assert.equal(redeemed.firstTime, true);
  assert.equal(redeemed.voter.email, "someone@gmail.com");
  assert.equal(redeemed.voter.community, null);
  assert.equal((await h.voters.byEmail("someone@gmail.com"))?.community, null);
});

test("a_domain_near_a_listed_one_but_not_on_it_gets_no_community", async () => {
  // The row is `student.ubc.ca` without subdomains. Its parent and its
  // children are different domains, so both sign in — as no community, not as
  // the listed one.
  const h = setup();
  for (const email of ["ada@ubc.ca", "sam@cs.student.ubc.ca"]) {
    assert.equal((await h.service.requestLink(email)).status, "sent");
    const redeemed = await h.service.redeem(h.lastToken(email));
    assert.equal(redeemed.status, "signed_in");
    if (redeemed.status !== "signed_in") return;
    assert.equal(redeemed.voter.community, null, email);
  }
});

test("a_matching_domain_still_records_its_community_on_the_claim", async () => {
  // Opening sign-up must not cost the label: the community is decided when
  // the link is asked for and carried on the claim, not re-derived later.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const claim = await h.claims.byTokenHash(
    hashToken(h.lastToken("ada@student.ubc.ca")),
  );
  assert.equal(claim?.community, "ubc-students");
});

test("says_what_is_wrong_with_an_unusable_address_and_sends_nothing", async () => {
  const h = setup();
  const result = await h.service.requestLink("not-an-address");
  assert.equal(result.status, "invalid_email");
  assert.equal(h.mailer.sent.length, 0);
});

test("throttles_an_address_holding_too_many_live_links", async () => {
  const h = setup({ maxLiveLinksPerEmail: 2 });
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "sent",
  );
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "sent",
  );
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "too_many_requests",
  );
  assert.equal(h.mailer.sent.length, 2);
});

test("the_throttle_lifts_once_the_old_links_expire", async () => {
  const h = setup({ maxLiveLinksPerEmail: 1, linkTtlMs: 60_000 });
  await h.service.requestLink("ada@student.ubc.ca");
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "too_many_requests",
  );

  h.after(60_001);
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "sent",
  );
});

test("one_persons_throttle_does_not_block_anyone_else", async () => {
  const h = setup({ maxLiveLinksPerEmail: 1 });
  await h.service.requestLink("ada@student.ubc.ca");
  assert.equal(
    (await h.service.requestLink("sam@student.ubc.ca")).status,
    "sent",
  );
});

test("the_raw_token_is_never_stored_only_its_hash", async () => {
  // A leaked claims table must not be usable to sign in as anyone.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");

  assert.equal(await h.claims.byTokenHash(token), undefined);
  const stored = await h.claims.byTokenHash(hashToken(token));
  assert.ok(stored);
  assert.equal(stored.email, "ada@student.ubc.ca");
});

test("proof_emails_are_off_unless_asked_for", async () => {
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const result = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(
    result.status === "signed_in" ? result.voter.proofEmailsOptIn : true,
    false,
  );
});

test("opting_in_later_is_honoured_and_signing_in_never_turns_it_off", async () => {
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca", { proofEmailsOptIn: true });
  const first = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(
    first.status === "signed_in" ? first.voter.proofEmailsOptIn : false,
    true,
  );

  // A later sign-in that says nothing about proof emails must leave the opt-in
  // alone rather than quietly unsubscribing them.
  await h.service.requestLink("ada@student.ubc.ca");
  const second = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(
    second.status === "signed_in" ? second.voter.proofEmailsOptIn : false,
    true,
  );
});

test("the_mailed_link_is_the_url_the_caller_builds", async () => {
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const message = h.mailer.lastTo("ada@student.ubc.ca");
  assert.match(message?.body ?? "", /^https:\/\/pulse\.test\/claim\?token=/);
  assert.equal(message?.kind, "claim-link");
});

test("the_slower_of_two_links_still_has_its_opt_in_honoured", async () => {
  // The second race above, but only the slower link asked for proof emails.
  // It loses the race to create the voter and signs in as the winner's — and
  // what it asked for must not be dropped on the way.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const first = h.lastToken("ada@student.ubc.ca");
  await h.service.requestLink("ada@student.ubc.ca", { proofEmailsOptIn: true });
  const second = h.lastToken("ada@student.ubc.ca");

  const [winner, loser] = await Promise.all([
    h.service.redeem(first),
    h.service.redeem(second),
  ]);
  assert.equal(winner.status === "signed_in" && winner.firstTime, true);
  assert.equal(loser.status === "signed_in" && loser.firstTime, false);
  assert.equal(
    (await h.voters.byEmail("ada@student.ubc.ca"))?.proofEmailsOptIn,
    true,
  );
});

test("a_link_used_and_since_expired_says_it_was_used", async () => {
  // "Used" is the more useful answer: the person already got in with it.
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca");
  const token = h.lastToken("ada@student.ubc.ca");
  assert.equal((await h.service.redeem(token)).status, "signed_in");
  h.after(16 * 60 * 1000);
  assert.equal((await h.service.redeem(token)).status, "already_used");
});

test("a_mail_provider_that_is_down_is_an_answer_the_person_can_act_on", async () => {
  // "Check your email" for mail that is never coming is the one answer worse
  // than saying nothing: the person waits instead of pressing the button again.
  // ADR-0027 makes a provider outage a refusal, not a fault.
  const logged: unknown[] = [];
  const h = setup(
    { log: (_message, error) => logged.push(error) },
    {
      mailer: {
        sendClaimLink: () => {
          throw new MailSendError(
            "the mail provider refused the message (422): domain is not verified",
          );
        },
        sendProofOfAction: async () => undefined,
      },
    },
  );

  const result = await h.service.requestLink("ada@student.ubc.ca");
  assert.equal(result.status, "send_failed");

  // The person is told to try again and nothing else. This is the ONLY place
  // the reason survives, and the one person who could act on it — whoever set
  // the sending domain — is not the person looking at the screen.
  assert.equal(logged.length, 1);
  assert.match(String(logged[0]), /domain is not verified/);
});

/**
 * A mailer that fails the next `failures` sends the way `fail` says, then
 * delivers like the console mailer. What a person meets when the provider
 * comes back after an outage.
 */
function flakyMailer(
  failures: number,
  fail: () => MailSendError,
): Mailer & { delivered: number } {
  let left = failures;
  const mailer = {
    delivered: 0,
    sendClaimLink: async () => {
      if (left > 0) {
        left -= 1;
        throw fail();
      }
      mailer.delivered += 1;
    },
    sendProofOfAction: async () => undefined,
  };
  return mailer;
}

test("a_send_the_provider_refused_does_not_spend_the_live_link_cap", async () => {
  // P4a. The provider answered "not now" (a 503), so no email went out and
  // no link is sitting in anyone's inbox. Keeping the claim would leave the
  // person told "A link is already on its way" after the provider recovers,
  // which is false.
  const mailer = flakyMailer(
    3,
    () => new MailSendError("provider unavailable", { status: 503 }),
  );
  const h = setup(
    { maxLiveLinksPerEmail: 2, log: () => undefined },
    { mailer },
  );

  for (let tries = 0; tries < 3; tries += 1) {
    assert.equal(
      (await h.service.requestLink("ada@student.ubc.ca")).status,
      "send_failed",
    );
  }
  assert.equal((await h.claims.liveFor("ada@student.ubc.ca", START)).length, 0);
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "sent",
  );
  assert.equal(mailer.delivered, 1);
});

for (const status of [408, 429]) {
  test(`a_${status}_refusal_also_frees_the_live_link_cap`, async () => {
    const mailer = flakyMailer(
      1,
      () => new MailSendError("provider refused", { status }),
    );
    const h = setup(
      { maxLiveLinksPerEmail: 1, log: () => undefined },
      { mailer },
    );
    await h.service.requestLink("ada@student.ubc.ca");
    assert.equal(
      (await h.claims.liveFor("ada@student.ubc.ca", START)).length,
      0,
    );
  });
}

for (const status of [500, 502, 504]) {
  test(`a_${status}_keeps_its_link_live_because_a_gateway_may_have_answered_after_delivery`, async () => {
    // Resend accepts and delivers, the gateway in front of it times out and
    // answers 504. The email is in the inbox; discarding would break it.
    const tokens: string[] = [];
    const h = setup(
      { maxLiveLinksPerEmail: 1, log: () => undefined },
      {
        mailer: {
          sendClaimLink: async (_to, link) => {
            tokens.push(new URL(link).searchParams.get("token") as string);
            throw new MailSendError("gateway gave up", { status });
          },
          sendProofOfAction: async () => undefined,
        },
      },
    );
    await h.service.requestLink("ada@student.ubc.ca");
    assert.equal(
      (await h.claims.liveFor("ada@student.ubc.ca", START)).length,
      1,
    );
    const [token] = tokens;
    assert.ok(token);
    assert.equal((await h.service.redeem(token)).status, "signed_in");
  });
}

test("a_discard_that_fails_still_answers_send_failed_not_a_fault", async () => {
  // Freeing the cap is best-effort; the person must still hear "try again".
  const logged: string[] = [];
  const mailer = flakyMailer(
    1,
    () => new MailSendError("provider unavailable", { status: 503 }),
  );
  const h = setup({ log: (message) => logged.push(message) }, { mailer });
  h.claims.discard = () => Promise.reject(new Error("database went away"));
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "send_failed",
  );
  assert.ok(logged.some((m) => /could not be discarded/.test(m)));
});

test("a_send_that_got_no_answer_keeps_its_link_live", async () => {
  // A timeout or a dropped connection: the provider may have accepted and
  // delivered the message anyway. Discarding the claim there would break a
  // link already in the inbox, so it stays and keeps counting until it
  // expires. MailSendError.status undefined is "never got an answer".
  const mailer = flakyMailer(
    2,
    () => new MailSendError("the mail provider could not be reached"),
  );
  const h = setup(
    { maxLiveLinksPerEmail: 2, log: () => undefined },
    { mailer },
  );

  await h.service.requestLink("ada@student.ubc.ca");
  await h.service.requestLink("ada@student.ubc.ca");
  assert.equal((await h.claims.liveFor("ada@student.ubc.ca", START)).length, 2);
  assert.equal(
    (await h.service.requestLink("ada@student.ubc.ca")).status,
    "too_many_requests",
  );
  assert.equal(mailer.delivered, 0);
});

test("a_link_whose_send_got_no_answer_still_signs_in_if_it_arrived", async () => {
  // The reason the claim is kept: the email may have been delivered.
  const tokens: string[] = [];
  const h = setup(
    { log: () => undefined },
    {
      mailer: {
        sendClaimLink: async (_to, link) => {
          tokens.push(new URL(link).searchParams.get("token") as string);
          throw new MailSendError("the mail provider could not be reached");
        },
        sendProofOfAction: async () => undefined,
      },
    },
  );
  await h.service.requestLink("ada@student.ubc.ca");
  const [token] = tokens;
  assert.ok(token);
  assert.equal((await h.service.redeem(token)).status, "signed_in");
});

test("a_mailer_fault_that_is_not_a_send_failure_is_still_a_fault", async () => {
  // The catch is scoped to MailSendError on purpose. A bug in a mailer — a
  // TypeError, a bad config read — must not be reported to the world as "the
  // provider is down", which is the sentence nobody investigates.
  const boom = new TypeError("mailer is broken");
  const h = setup(
    { log: () => undefined },
    {
      mailer: {
        sendClaimLink: () => {
          throw boom;
        },
        sendProofOfAction: async () => undefined,
      },
    },
  );

  await assert.rejects(h.service.requestLink("ada@student.ubc.ca"), boom);
});
