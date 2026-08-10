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
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";

const START = new Date("2026-08-09T12:00:00.000Z");

/** A service wired to one community, a silent mailer, and a movable clock. */
function setup(options: ClaimOptions = {}) {
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
      mailer,
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

test("turns_away_an_address_from_a_domain_no_community_claimed", async () => {
  const h = setup();
  const result = await h.service.requestLink("someone@gmail.com");
  assert.equal(result.status, "not_a_member");
  assert.equal(
    result.status === "not_a_member" ? result.domain : "",
    "gmail.com",
  );
  assert.equal(h.mailer.sent.length, 0);
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
    result.status === "signed_in" ? result.voter.wantsProofEmails : true,
    false,
  );
});

test("opting_in_later_is_honoured_and_signing_in_never_turns_it_off", async () => {
  const h = setup();
  await h.service.requestLink("ada@student.ubc.ca", { wantsProofEmails: true });
  const first = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(
    first.status === "signed_in" ? first.voter.wantsProofEmails : false,
    true,
  );

  // A later sign-in that says nothing about proof emails must leave the opt-in
  // alone rather than quietly unsubscribing them.
  await h.service.requestLink("ada@student.ubc.ca");
  const second = await h.service.redeem(h.lastToken("ada@student.ubc.ca"));
  assert.equal(
    second.status === "signed_in" ? second.voter.wantsProofEmails : false,
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
