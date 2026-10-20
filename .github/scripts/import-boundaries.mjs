import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Resolve existing ancestors too: a not-yet-created file beneath a symlink
// must have the same owner as a file that already exists there.
function realPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file
    ? file
    : path.join(realPath(parent), path.basename(file));
}

export function createBoundaryRule(root) {
  root = realPath(root);
  const packages = new Map();
  for (const group of ["apps", "services", "tools", "tests", "contracts"]) {
    const base = path.join(root, group);
    if (!fs.existsSync(base)) continue;
    for (const dir of [
      base,
      ...fs.readdirSync(base).map((name) => path.join(base, name)),
    ]) {
      const metadata = path.join(dir, "package.json");
      if (fs.existsSync(metadata)) {
        const { name } = JSON.parse(fs.readFileSync(metadata, "utf8"));
        if (name) packages.set(name, dir);
      }
    }
  }
  const configs = new Map();
  function optionsFor(filename) {
    const config = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists);
    if (!config) return { moduleResolution: ts.ModuleResolutionKind.Bundler };
    if (!configs.has(config)) {
      const result = ts.readConfigFile(config, ts.sys.readFile);
      if (result.error)
        throw new Error(`Cannot read boundary resolver config: ${config}`);
      // Only compiler options are needed; do not enumerate or read source files.
      const parsed = ts.parseJsonConfigFileContent(
        { ...result.config, files: [], include: [] },
        ts.sys,
        path.dirname(config),
      );
      const errors = parsed.errors.filter(
        (error) => error.code !== 18002 && error.code !== 18003,
      );
      if (errors.length)
        throw new Error(
          ts.formatDiagnosticsWithColorAndContext(errors, {
            getCanonicalFileName: (name) => name,
            getCurrentDirectory: () => root,
            getNewLine: () => "\n",
          }),
        );
      configs.set(config, parsed.options);
    }
    return configs.get(config);
  }
  function owner(filename) {
    const relative = path.relative(root, filename).split(path.sep);
    if (relative.includes("node_modules")) return undefined;
    if (["apps", "services", "tools"].includes(relative[0]) && relative[1]) {
      return relative.slice(0, 2).join("/");
    }
    if (relative[0] === "contracts") return "contracts/";
    if (relative[0] === "tests" && relative[1] === "pulse-integration")
      return "tests/pulse-integration";
    return undefined;
  }
  const isCore = (name) => /^(services|tools|contracts)\//.test(name);
  const integration = "tests/pulse-integration";
  function forbidden(from, to) {
    if (!from || !to || from === to) return false;
    if (from === integration)
      return !["apps/pulse", "apps/pulse-web"].includes(to);
    if (to === integration) return true;
    if (from.startsWith("apps/")) return isCore(to) || to.startsWith("apps/");
    return isCore(from) && to.startsWith("apps/");
  }
  function destinations(specifier, filename) {
    const options = optionsFor(filename);
    const resolution = ts.resolveModuleName(
      specifier,
      filename,
      options,
      ts.sys,
    );
    const candidates = [];
    if (resolution.resolvedModule)
      candidates.push(resolution.resolvedModule.resolvedFileName);
    else candidates.push(...(resolution.failedLookupLocations ?? []));
    // Workspace ownership is independent of pnpm linking and package exports.
    for (const [name, dir] of packages) {
      if (specifier === name || specifier.startsWith(`${name}/`)) {
        candidates.push(path.resolve(dir, specifier.slice(name.length + 1)));
      }
    }
    if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
      candidates.push(path.resolve(path.dirname(filename), specifier));
    }
    if (specifier.startsWith("file:"))
      candidates.push(fileURLToPath(specifier));
    return candidates.flatMap((file) => [file, realPath(file)]);
  }
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        boundary:
          "Import boundary: {{from}} -> {{to}} via '{{specifier}}'. Use the public HTTP API; only tests/pulse-integration may import both Pulse apps.",
        computed:
          "Computed module import cannot be checked in {{from}}. Use a literal module specifier so import boundaries can be enforced.",
      },
    },
    create(context) {
      const filename = context.filename;
      const origins = [filename, realPath(filename)].map(owner).filter(Boolean);
      if (!origins.length) return {};
      return {
        Program() {
          const source = ts.createSourceFile(
            filename,
            context.sourceCode.text,
            ts.ScriptTarget.Latest,
            true,
          );
          function check(expression) {
            const location = source.getLineAndCharacterOfPosition(
              expression.getStart(source),
            );
            const loc = { line: location.line + 1, column: location.character };
            if (!ts.isStringLiteralLike(expression)) {
              context.report({
                loc,
                messageId: "computed",
                data: { from: origins[0] },
              });
              return;
            }
            for (const target of destinations(expression.text, filename)) {
              const to = owner(target);
              const from = origins.find((origin) => forbidden(origin, to));
              if (from) {
                context.report({
                  loc,
                  messageId: "boundary",
                  data: { from, to, specifier: expression.text },
                });
                return;
              }
            }
          }
          function visit(node) {
            if (
              (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
              node.moduleSpecifier
            ) {
              check(node.moduleSpecifier);
            } else if (
              ts.isImportTypeNode(node) &&
              ts.isLiteralTypeNode(node.argument)
            ) {
              check(node.argument.literal);
            } else if (ts.isExternalModuleReference(node) && node.expression) {
              check(node.expression);
            } else if (ts.isCallExpression(node)) {
              const expression = node.expression;
              const loader =
                expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(expression) &&
                  expression.text === "require") ||
                (ts.isPropertyAccessExpression(expression) &&
                  ((expression.expression.getText(source) === "require" &&
                    expression.name.text === "resolve") ||
                    (expression.expression.getText(source) === "module" &&
                      expression.name.text === "require")));
              if (loader && node.arguments[0]) check(node.arguments[0]);
            }
            ts.forEachChild(node, visit);
          }
          visit(source);
        },
      };
    },
  };
}

export default {
  rules: {
    imports: createBoundaryRule(
      fileURLToPath(new URL("../../", import.meta.url)),
    ),
  },
};
