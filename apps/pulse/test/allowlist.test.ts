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
