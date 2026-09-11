import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { parseEmail } from "../src/identity/email.js";

function allowlist(rows: ConstructorParameters<typeof StaticDomainSource>[0]) {
  return new DomainAllowlist(new StaticDomainSource(rows));
}

test("admits_an_address_whose_domain_is_listed", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  const membership = await list.check(parseEmail("ada@student.ubc.ca"));

  assert.equal(membership?.community, "ubc-students");
  assert.equal(membership?.via.domain, "student.ubc.ca");
});

test("turns_away_an_address_whose_domain_is_not_listed", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  assert.equal(await list.check(parseEmail("ada@gmail.com")), undefined);
});

test("an_empty_allowlist_admits_nobody", async () => {
  // The failure that would matter most: an empty table must never mean "open to
  // everyone".
  const list = allowlist([]);
  assert.equal(await list.check(parseEmail("ada@student.ubc.ca")), undefined);
});

test("adding_a_community_is_a_row_not_a_code_change", async () => {
  const rows = [{ community: "ubc-students", domain: "student.ubc.ca" }];
  assert.equal(
    await allowlist(rows).check(parseEmail("sam@sfu.ca")),
    undefined,
  );

  rows.push({ community: "sfu", domain: "sfu.ca" });
  assert.equal(
    (await allowlist(rows).check(parseEmail("sam@sfu.ca")))?.community,
    "sfu",
  );
});

test("subdomains_are_excluded_unless_the_row_says_otherwise", async () => {
  const strict = allowlist([{ community: "ubc", domain: "ubc.ca" }]);
  assert.equal(await strict.check(parseEmail("ada@student.ubc.ca")), undefined);

  const wide = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.equal(
    (await wide.check(parseEmail("ada@student.ubc.ca")))?.community,
    "ubc",
  );
});

test("a_subdomain_row_does_not_admit_the_parent_domain", async () => {
  const list = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.equal((await list.check(parseEmail("ada@ubc.ca")))?.community, "ubc");
  assert.equal(await list.check(parseEmail("ada@notubc.ca")), undefined);
});

test("a_lookalike_domain_is_not_a_subdomain", async () => {
  // "evilubc.ca" ends with "ubc.ca" as a string but is a different domain.
  const list = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.equal(await list.check(parseEmail("ada@evilubc.ca")), undefined);
});

test("the_most_specific_row_wins_when_several_match", async () => {
  const list = allowlist([
    { community: "ubc-everyone", domain: "ubc.ca", includeSubdomains: true },
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  assert.equal(
    (await list.check(parseEmail("ada@student.ubc.ca")))?.community,
    "ubc-students",
  );
  assert.equal(
    (await list.check(parseEmail("prof@faculty.ubc.ca")))?.community,
    "ubc-everyone",
  );
});

test("rows_match_regardless_of_the_case_they_were_entered_in", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "  Student.UBC.ca " },
  ]);
  assert.equal(
    (await list.check(parseEmail("ADA@student.ubc.ca")))?.community,
    "ubc-students",
  );
});

test("two_communities_claiming_one_domain_resolve_the_same_way_either_way_round", async () => {
  // ADR-0023: `allowed_domain` is keyed on (community, domain), so a domain
  // may serve several communities. Both rows then match the same address at
  // the same length, and `>` alone keeps whichever one the source happened to
  // hand over first — a static array's literal order today, and a table query
  // with no ORDER BY tomorrow. Same address, different community, run to run.
  //
  // The interim rule is longest domain, then lowest community alphabetically.
  // Asserted over BOTH row orderings, because a rule that only works in the
  // order it was written in is the bug, not the fix.
  const forward = [
    { community: "ubc-alumni", domain: "ubc.ca" },
    { community: "ubc-staff", domain: "ubc.ca" },
  ];
  const backward = [...forward].reverse();

  for (const rows of [forward, backward]) {
    const membership = await allowlist(rows).check(parseEmail("ada@ubc.ca"));
    assert.equal(membership?.community, "ubc-alumni");
    // `via` is the row that admitted them, and must be the same row, not just
    // a row with the same community.
    assert.equal(membership?.via.community, "ubc-alumni");
  }
});

test("a_longer_domain_still_beats_an_alphabetically_earlier_community", async () => {
  // The tie-break is second, not first: specificity still decides whenever the
  // domains differ. A community-first rule would hand "aaa" every address in
  // the system, which is the obvious way to get this wrong.
  const list = allowlist([
    { community: "aaa-everyone", domain: "ubc.ca", includeSubdomains: true },
    { community: "zzz-students", domain: "student.ubc.ca" },
  ]);
  assert.equal(
    (await list.check(parseEmail("ada@student.ubc.ca")))?.community,
    "zzz-students",
  );
});
