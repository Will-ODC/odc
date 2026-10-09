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

/** The communities an address proves, in the order they come back. */
async function communities(
  list: DomainAllowlist,
  address: string,
): Promise<string[]> {
  return (await list.memberships(parseEmail(address))).map((m) => m.community);
}

test("names_the_community_of_an_address_whose_domain_is_listed", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  const found = await list.memberships(parseEmail("ada@student.ubc.ca"));

  assert.equal(found.length, 1);
  assert.equal(found[0]?.community, "ubc-students");
  assert.equal(found[0]?.via.domain, "student.ubc.ca");
});

test("finds_no_community_for_an_address_whose_domain_is_not_listed", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  assert.deepEqual(await communities(list, "ada@gmail.com"), []);
});

test("an_empty_allowlist_names_no_community", async () => {
  // Since ADR-0030 anyone signs in whatever this says, so an empty table is a
  // fresh deployment, not a locked one. What it must never do is put everyone
  // in a community nobody listed.
  assert.deepEqual(await communities(allowlist([]), "ada@student.ubc.ca"), []);
});

test("adding_a_community_is_a_row_not_a_code_change", async () => {
  const rows = [{ community: "ubc-students", domain: "student.ubc.ca" }];
  assert.deepEqual(await communities(allowlist(rows), "sam@sfu.ca"), []);

  rows.push({ community: "sfu", domain: "sfu.ca" });
  assert.deepEqual(await communities(allowlist(rows), "sam@sfu.ca"), ["sfu"]);
});

test("subdomains_are_excluded_unless_the_row_says_otherwise", async () => {
  const strict = allowlist([{ community: "ubc", domain: "ubc.ca" }]);
  assert.deepEqual(await communities(strict, "ada@student.ubc.ca"), []);

  const wide = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.deepEqual(await communities(wide, "ada@student.ubc.ca"), ["ubc"]);
});

test("a_subdomain_row_does_not_match_the_parent_domain", async () => {
  const list = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.deepEqual(await communities(list, "ada@ubc.ca"), ["ubc"]);
  assert.deepEqual(await communities(list, "ada@notubc.ca"), []);
});

test("a_lookalike_domain_is_not_a_subdomain", async () => {
  // "evilubc.ca" ends with "ubc.ca" as a string but is a different domain.
  const list = allowlist([
    { community: "ubc", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.deepEqual(await communities(list, "ada@evilubc.ca"), []);
});

test("only_the_most_specific_rows_count_when_rows_of_different_reach_match", async () => {
  // A narrower row carves a community out of a broader one; it does not make
  // the person choose between the carve-out and the thing it was carved from.
  const list = allowlist([
    { community: "ubc-everyone", domain: "ubc.ca", includeSubdomains: true },
    { community: "ubc-students", domain: "student.ubc.ca" },
  ]);
  assert.deepEqual(await communities(list, "ada@student.ubc.ca"), [
    "ubc-students",
  ]);
  assert.deepEqual(await communities(list, "prof@faculty.ubc.ca"), [
    "ubc-everyone",
  ]);
});

test("rows_match_regardless_of_the_case_they_were_entered_in", async () => {
  const list = allowlist([
    { community: "ubc-students", domain: "  Student.UBC.ca " },
  ]);
  assert.deepEqual(await communities(list, "ADA@student.ubc.ca"), [
    "ubc-students",
  ]);
});

test("two_communities_claiming_one_domain_are_both_returned_either_way_round", async () => {
  // ADR-0023: `allowed_domain` is keyed on (community, domain), so a domain
  // may serve several communities, and the person picks (P2). This method
  // must not pick for them — and the list must read the same whichever order
  // the source handed the rows over in, because a table query with no ORDER
  // BY promises nothing about that.
  const forward = [
    { community: "ubc-staff", domain: "ubc.ca" },
    { community: "ubc-alumni", domain: "ubc.ca" },
  ];
  const backward = [...forward].reverse();

  for (const rows of [forward, backward]) {
    const found = await allowlist(rows).memberships(parseEmail("ada@ubc.ca"));
    assert.deepEqual(
      found.map((m) => m.community),
      ["ubc-alumni", "ubc-staff"],
    );
    // `via` is the row that named each community, not just a row.
    assert.deepEqual(
      found.map((m) => m.via.community),
      ["ubc-alumni", "ubc-staff"],
    );
  }
});

test("a_longer_domain_still_beats_an_alphabetically_earlier_community", async () => {
  // Specificity decides whenever the domains differ. A community-first rule
  // would hand "aaa" every address in the system, which is the obvious way to
  // get this wrong — and offering it as a choice would be the second way.
  const list = allowlist([
    { community: "aaa-everyone", domain: "ubc.ca", includeSubdomains: true },
    { community: "zzz-students", domain: "student.ubc.ca" },
  ]);
  assert.deepEqual(await communities(list, "ada@student.ubc.ca"), [
    "zzz-students",
  ]);
});

test("an_exact_row_and_a_subdomain_row_for_one_domain_are_both_choices", async () => {
  // Same domain, same length, different communities: the subdomain flag does
  // not make one row more specific than the other at the domain itself.
  const list = allowlist([
    { community: "ubc-staff", domain: "ubc.ca" },
    { community: "ubc-everyone", domain: "ubc.ca", includeSubdomains: true },
  ]);
  assert.deepEqual(await communities(list, "ada@ubc.ca"), [
    "ubc-everyone",
    "ubc-staff",
  ]);
});
