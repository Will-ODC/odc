import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { createBoundaryRule } from "./import-boundaries.mjs";

const root = mkdtempSync(path.join(tmpdir(), "odc-boundaries-"));
after(() => rmSync(root, { recursive: true, force: true }));
function put(file, content = "export interface Value {}") {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
for (const [dir, name] of [
  ["apps/pulse", "@fixture/api"],
  ["apps/pulse-web", "@fixture/web"],
  ["services/ledger", "@fixture/ledger"],
  ["tools/helper", "@fixture/helper"],
  ["contracts", "@fixture/contracts"],
  ["tests/pulse-integration", "@fixture/integration"],
]) {
  put(`${dir}/package.json`, JSON.stringify({ name, main: "src/value.ts" }));
  put(`${dir}/src/value.ts`);
}
put(
  "apps/pulse/tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      baseUrl: "../..",
      paths: {
        "@core/*": ["services/ledger/src/*"],
        "@local/*": ["apps/pulse/src/*"],
      },
    },
  }),
);
mkdirSync(path.join(root, "apps/pulse/src"), { recursive: true });
symlinkSync(
  path.join(root, "services/ledger/src"),
  path.join(root, "apps/pulse/src/core-link"),
);
symlinkSync(
  path.join(root, "apps/pulse-web/src"),
  path.join(root, "apps/pulse/src/web-link"),
);
const linter = new Linter({ cwd: root });
const rule = createBoundaryRule(root);
function lint(source, filename = "apps/pulse/src/entry.ts") {
  return linter.verify(
    source,
    [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: { parser: tseslint.parser },
        plugins: { boundaries: { rules: { imports: rule } } },
        rules: { "boundaries/imports": "error" },
      },
    ],
    { filename: path.join(root, filename) },
  );
}
const rejected = [
  ["relative service", 'import "../../../services/ledger/src/value.js";'],
  [
    "normalized relative",
    'import "../../../apps/../services//ledger/src/value.js";',
  ],
  ["contracts", 'import "../../../contracts/src/value.js";'],
  ["tools", 'import "@fixture/helper";'],
  ["absolute path", `import "${root}/services/ledger/src/value.ts";`],
  [
    "file URL",
    `import "${pathToFileURL(path.join(root, "services/ledger/src/value.ts"))}";`,
  ],
  ["type-only import", 'import type {Value} from "@fixture/contracts";'],
  ["named re-export", 'export {Value} from "@fixture/ledger";'],
  ["star re-export", 'export * from "@fixture/ledger/src/value.js";'],
  ["literal dynamic import", 'import("@fixture/ledger");'],
  ["template literal dynamic import", "import(`@fixture/ledger`);"],
  ["import type expression", 'type X = import("@fixture/ledger").Value;'],
  ["CommonJS require", 'require("@fixture/ledger");'],
  ["CommonJS resolve", 'require.resolve("@fixture/ledger");'],
  ["module require", 'module.require("@fixture/ledger");'],
  ["TypeScript import equals", 'import X = require("@fixture/ledger");'],
  ["TS paths alias", 'import "@core/value";'],
  ["TS baseUrl", 'import "services/ledger/src/value";'],
  ["missing alias target", 'import "@core/not-created-yet";'],
  [
    "missing relative target",
    'import "../../../services/ledger/src/missing.js";',
  ],
  ["service symlink", 'import "./core-link/value.js";'],
  ["app symlink", 'import "./web-link/value.js";'],
  ["unlinked workspace", 'import "@fixture/web";'],
  [
    "app-owned tests",
    'import "../../pulse/src/value.js";',
    "apps/pulse-web/test/unit.ts",
  ],
  ["service to app", 'import "@fixture/api";', "services/ledger/src/entry.ts"],
  ["tools to app", 'import "@fixture/api";', "tools/helper/src/entry.ts"],
  [
    "integration to tools",
    'import "@fixture/helper";',
    "tests/pulse-integration/test/a.ts",
  ],
  [
    "integration to service",
    'import "@fixture/ledger";',
    "tests/pulse-integration/test/a.ts",
  ],
  [
    "integration to contracts",
    'import "@fixture/contracts";',
    "tests/pulse-integration/test/a.ts",
  ],
];
for (const [name, source, filename] of rejected) {
  test(`rejects ${name} with source and destination paths`, () => {
    const messages = lint(source, filename);
    assert.equal(messages.length, 1, JSON.stringify(messages));
    assert.match(
      messages[0].message,
      /Import boundary: .* -> (services|contracts|apps|tools)\//,
    );
    assert.equal(messages[0].ruleId, "boundaries/imports");
  });
}
for (const source of [
  "import(target);",
  'require(prefix + "/value");',
  "import(`./${name}`);",
]) {
  test(`diagnoses computed module expression: ${source}`, () => {
    assert.match(
      lint(source)[0].message,
      /Computed module import cannot be checked/,
    );
  });
}
for (const [name, source, filename] of [
  ["same package relative", 'import "./value.js";'],
  ["same package alias", 'import "@local/value";'],
  ["same package workspace", 'import "@fixture/api/src/value.js";'],
  ["external dependency", 'import "react";'],
  ["Node builtin", 'import "node:fs";'],
  [
    "core contracts",
    'import "@fixture/contracts";',
    "services/ledger/src/entry.ts",
  ],
  [
    "integration API",
    'import "@fixture/api/src/value.js";',
    "tests/pulse-integration/test/a.ts",
  ],
  [
    "integration browser",
    'import "@fixture/web/src/value.js";',
    "tests/pulse-integration/test/a.ts",
  ],
  ["root tooling", 'import "@fixture/api";', ".github/scripts/check.ts"],
]) {
  test(`allows ${name}`, () => assert.deepEqual(lint(source, filename), []));
}

test("root ESLint loads the boundary rule for app and integration source", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const eslint = new ESLint({ cwd: repository });
  const [rejected] = await eslint.lintText(
    'import "../../../services/ledger/src/synthetic.ts";',
    {
      filePath: path.join(repository, "apps/pulse/src/synthetic.ts"),
    },
  );
  assert.equal(
    rejected.messages.filter(
      (message) => message.ruleId === "boundaries/imports",
    ).length,
    1,
  );
  const [allowed] = await eslint.lintText(
    'import "../../../apps/pulse/src/synthetic.ts";',
    {
      filePath: path.join(
        repository,
        "tests/pulse-integration/test/synthetic.ts",
      ),
    },
  );
  assert.deepEqual(allowed.messages, []);
});
