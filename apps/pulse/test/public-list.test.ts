import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AddressLimit } from "../src/http/address-limit.js";
import { ConfirmationKey } from "../src/voting/confirmation.js";
import {
  parsePublicVotesQuery,
  PublicVotesCursor,
  publicVotesPage,
} from "../src/voting/public-list.js";

// ADR-0048 decision 7: the list's sealed cursor, its query and its one
// projection, and the per-address counter its route and MCP share.

const KEY = new ConfirmationKey("a-confirmation-key-for-tests-0123456789");
const OTHER_KEY = new ConfirmationKey("another-confirmation-key-0123456789ab");

test("a_sealed_cursor_opens_to_its_list_key_only_for_its_poll", () => {
  const cursor = new PublicVotesCursor(KEY);
  const listKey = randomUUID();
  const sealed = cursor.seal("p1", listKey);
  assert.equal(cursor.open("p1", sealed), listKey);
  assert.equal(cursor.open("p2", sealed), undefined);
  // Neither the poll nor the key is readable in it.
  const raw = Buffer.from(sealed, "base64url").toString("latin1");
  assert.ok(!raw.includes("p1"));
  assert.ok(!raw.includes(listKey));
});

test("the_same_position_seals_differently_every_time", () => {
  const cursor = new PublicVotesCursor(KEY);
  const listKey = randomUUID();
  const seen = new Set(
    Array.from({ length: 20 }, () => cursor.seal("p1", listKey)),
  );
  assert.equal(seen.size, 20);
});

test("a_cursor_under_another_key_or_tampered_or_truncated_does_not_open", () => {
  const cursor = new PublicVotesCursor(KEY);
  const sealed = cursor.seal("p1", randomUUID());
  assert.equal(new PublicVotesCursor(OTHER_KEY).open("p1", sealed), undefined);
  const bytes = Buffer.from(sealed, "base64url");
  for (let i = 0; i < bytes.length; i++) {
    const flipped = Buffer.from(bytes);
    flipped[i] = (flipped[i] ?? 0) ^ 0x01;
    assert.equal(cursor.open("p1", flipped.toString("base64url")), undefined);
  }
  for (const bad of [
    "",
    "AAAA",
    bytes.subarray(0, 28).toString("base64url"),
    `${sealed}=`,
  ])
    assert.equal(cursor.open("p1", bad), undefined, bad);
});

test("the_cursor_key_is_its_own_and_not_a_code_or_lock_key", () => {
  const key = KEY.cursorKey();
  assert.equal(key.length, 32);
  assert.notEqual(key.toString("hex"), KEY.codeFor("", ""));
  assert.deepEqual(KEY.cursorKey(), key);
  assert.notDeepEqual(OTHER_KEY.cursorKey(), key);
});

test("the_list_query_takes_limit_1_to_50_and_a_cursor_and_nothing_else", () => {
  assert.deepEqual(parsePublicVotesQuery({}), { limit: 20 });
  assert.deepEqual(parsePublicVotesQuery({ limit: "50", cursor: "abc_-" }), {
    limit: 50,
    cursor: "abc_-",
  });
  for (const raw of [
    { limit: "0" },
    { limit: "51" },
    { limit: "07" },
    { cursor: "" },
    { cursor: "a+b" },
    { cursor: "a".repeat(2049) },
    { other: "1" },
  ])
    assert.equal(parsePublicVotesQuery(raw), undefined, JSON.stringify(raw));
});

test("a_page_shows_name_and_choices_only_and_seals_the_last_shown_key", () => {
  const cursor = new PublicVotesCursor(KEY);
  const entries = [
    { name: "Ada", choices: [1], listKey: randomUUID() },
    { name: null, choices: [0, 2], listKey: randomUUID() },
  ];
  const page = publicVotesPage("p1", entries, 1, cursor);
  assert.deepEqual(page.items, [{ name: "Ada", choices: [1] }]);
  assert.equal(cursor.open("p1", page.nextCursor ?? ""), entries[0]?.listKey);
  assert.deepEqual(publicVotesPage("p1", entries, 2, cursor), {
    items: [
      { name: "Ada", choices: [1] },
      { name: null, choices: [0, 2] },
    ],
    nextCursor: null,
  });
});

test("an_address_limit_counts_per_address_in_fixed_windows", () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const limit = new AddressLimit({ max: 2, timeWindow: 60_000 }, () => now);
  assert.deepEqual(limit.take("a"), { allowed: true });
  assert.deepEqual(limit.take("a"), { allowed: true });
  assert.deepEqual(limit.take("a"), {
    allowed: false,
    retryAfterSeconds: 60,
  });
  assert.deepEqual(limit.take("b"), { allowed: true });
  now = new Date(now.getTime() + 59_500);
  assert.deepEqual(limit.take("a"), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  now = new Date(now.getTime() + 500);
  assert.deepEqual(limit.take("a"), { allowed: true });
});

test("an_address_limit_sweeps_expired_windows_and_refuses_bad_options", () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const limit = new AddressLimit({ max: 1, timeWindow: 1000 }, () => now);
  for (let i = 0; i < 2000; i++) limit.take(`10.0.${i >> 8}.${i & 255}`);
  now = new Date(now.getTime() + 1000);
  // A new address past the threshold sweeps; counting stays correct after.
  assert.deepEqual(limit.take("fresh"), { allowed: true });
  assert.deepEqual(limit.take("fresh").allowed, false);
  assert.deepEqual(limit.take("10.0.0.0"), { allowed: true });
  assert.deepEqual(limit.take("10.0.0.0").allowed, false);
  for (const options of [
    { max: 0, timeWindow: 1000 },
    { max: 1.5, timeWindow: 1000 },
    { max: 1, timeWindow: 0 },
    { max: 1, timeWindow: Number.NaN },
  ])
    assert.throws(() => new AddressLimit(options, () => now), RangeError);
});

test("an_address_limit_holds_at_most_its_capacity_evicting_the_oldest", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const limit = new AddressLimit({ max: 1, timeWindow: 60_000 }, () => now, 3);
  for (const address of ["a", "b", "c"]) limit.take(address);
  assert.equal(limit.take("a").allowed, false);
  // Within one window, a fourth address drops the oldest, "a".
  assert.deepEqual(limit.take("d"), { allowed: true });
  assert.equal(limit.size, 3);
  assert.equal(limit.take("b").allowed, false);
  assert.equal(limit.take("d").allowed, false);
  assert.deepEqual(limit.take("a"), { allowed: true });
  assert.equal(limit.size, 3);
  // Many addresses in one window never grow it past the cap.
  const big = new AddressLimit({ max: 1, timeWindow: 60_000 }, () => now, 2000);
  for (let i = 0; i < 50_000; i++) big.take(`2001:db8::${i.toString(16)}`);
  assert.equal(big.size, 2000);
  assert.throws(
    () => new AddressLimit({ max: 1, timeWindow: 1 }, () => now, 0),
    RangeError,
  );
});
