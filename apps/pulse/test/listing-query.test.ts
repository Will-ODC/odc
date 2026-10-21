import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePollListQuery } from "../src/voting/listing.js";

const valid = {
  v: 1,
  community: "campus",
  at: "2026-10-20T12:00:00.000Z",
  id: "a",
};
function cursor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
test("listing accepts the default, maximum limit and public cursor keys", () => {
  assert.deepEqual(parsePollListQuery({ community: "campus" }), {
    community: "campus",
    limit: 20,
  });
  assert.deepEqual(
    parsePollListQuery({
      community: "campus",
      limit: "100",
      cursor: cursor(valid),
    }),
    {
      community: "campus",
      limit: 100,
      before: { createdAt: new Date(valid.at), id: "a" },
    },
  );
});
test("listing rejects malformed and unsupported cursors before storage", () => {
  for (const value of [
    null,
    [],
    {},
    { ...valid, v: 2 },
    { ...valid, at: "not a date" },
    { ...valid, at: "0000-01-01T00:00:00.000Z" },
    { ...valid, id: "" },
    { ...valid, id: "a\0b" },
    { ...valid, secret: "unexpected" },
  ]) {
    assert.equal(
      parsePollListQuery({ community: "campus", cursor: cursor(value) }),
      undefined,
    );
  }
  assert.equal(parsePollListQuery({ community: "cam\0pus" }), undefined);
  assert.equal(
    parsePollListQuery({ community: "campus", limit: ["1", "2"] }),
    undefined,
  );
  assert.equal(
    parsePollListQuery({
      community: "campus",
      cursor: [cursor(valid), cursor(valid)],
    }),
    undefined,
  );
});
