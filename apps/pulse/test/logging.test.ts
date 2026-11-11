import assert from "node:assert/strict";
import { test } from "node:test";
import { MailRejectedError, MailSendError } from "../src/identity/mailer.js";
import { logFault, type Fault } from "../src/logging.js";

function throwingGetter(): never {
  throw new Error("getter private-person@example.test");
}

for (const field of [
  "code",
  "status",
  "constructor",
  "constructor name",
  "prototype",
]) {
  test(`logFault_drops_unreadable_${field.replaceAll(" ", "_")}`, () => {
    let error: unknown = Object.assign(
      new MailSendError("private-message", { status: 503 }),
      {
        code: "08006",
      },
    );
    const expected: Fault = {
      type: "MailSendError",
      code: "08006",
      status: 503,
    };
    if (field === "code" || field === "status") {
      Object.defineProperty(error, field, { get: throwingGetter });
      delete expected[field];
    } else if (field === "prototype") {
      error = new Proxy(error as Error, { getPrototypeOf: throwingGetter });
      expected.type = "object";
      delete expected.status;
    } else {
      const prototype = Object.create(MailSendError.prototype);
      Object.defineProperty(
        prototype,
        "constructor",
        field === "constructor"
          ? { get: throwingGetter }
          : {
              value: Object.defineProperty({}, "name", { get: throwingGetter }),
            },
      );
      Object.setPrototypeOf(error, prototype);
      expected.type = "Error";
    }
    const logged: unknown[] = [];
    assert.doesNotThrow(() =>
      logFault(
        (fields, message) => logged.push([fields, message]),
        error,
        "failed",
      ),
    );
    assert.deepEqual(logged, [[{ fault: expected }, "failed"]]);
    assert.doesNotMatch(
      JSON.stringify(logged),
      /private-person|private-message/,
    );
  });
}

test("logFault_keeps_readable_allow_listed_metadata", () => {
  const logged: Fault[] = [];
  const log = ({ fault }: { fault: Fault }) => logged.push(fault);
  logFault(log, new MailRejectedError("private-message", 403), "failed");
  logFault(
    log,
    Object.assign(new TypeError("private-message"), { code: "XX000" }),
    "failed",
  );
  logFault(log, null, "failed");
  assert.deepEqual(logged, [
    { type: "MailRejectedError", status: 403 },
    { type: "TypeError", code: "XX000" },
    { type: "object" },
  ]);
});

test("logFault_does_not_throw_when_the_log_sink_throws", () => {
  assert.doesNotThrow(() =>
    logFault(throwingGetter, new Error("private-message"), "failed"),
  );
});
