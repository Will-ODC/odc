import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, serverConfig } from "../../src/config.js";

const DB = { LEDGER_DATABASE_URL: "postgres://u:p@127.0.0.1:5434/ledger" };

test("the_signer_url_is_required_and_trimmed", () => {
  for (const v of [undefined, "", "  "]) {
    assert.throws(
      () => serverConfig({ ...DB, LEDGER_SIGNER_URL: v }),
      (e: unknown) =>
        e instanceof ConfigError && /LEDGER_SIGNER_URL/.test(e.message),
    );
  }
  const c = serverConfig({ ...DB, LEDGER_SIGNER_URL: " http://s:1 " });
  assert.equal(c.signerUrl, "http://s:1");
  assert.equal(c.internalHost, "127.0.0.1");
});

test("the_signer_url_must_be_an_http_or_https_url", () => {
  for (const v of ["signer:9000", "ftp://s/", "not a url", "//s:1"]) {
    assert.throws(
      () => serverConfig({ ...DB, LEDGER_SIGNER_URL: v }),
      (e: unknown) =>
        e instanceof ConfigError && /http\(s\) URL/.test(e.message),
      v,
    );
  }
  // A rejected value is never echoed: it may carry credentials.
  const secret = "htps://user:token123@signer";
  assert.throws(
    () => serverConfig({ ...DB, LEDGER_SIGNER_URL: secret }),
    (e: unknown) => e instanceof ConfigError && !e.message.includes("token123"),
  );
  assert.equal(
    serverConfig({ ...DB, LEDGER_SIGNER_URL: "https://s.internal:9000/" })
      .signerUrl,
    "https://s.internal:9000/",
  );
});
