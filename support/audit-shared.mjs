// Import-aware leak audit for the platform-ports refactor. Enforces the success criterion: SHARED code — every
// src file OUTSIDE the two backends src/platform/{electron,tauri} — reaches the host only through
// contract-typed ports/globals, never importing node:*/electron/@tauri-apps/a node-coupled dep, and never using
// process/Buffer/__dirname at runtime (type-only is fine). It is AST-based (via the TypeScript parser), so a
// forbidden token inside a string/template/comment — e.g. the `import http from "node:http"` code SAMPLE shown in
// ConnectionInfoScreen — is NOT flagged; only real import statements + value-position identifiers are.
//
// Excluded: the two backends; all tests (*.test.ts(x), *.live.ts, src/__tests__/**) — they run under Node and
// are never shipped; and the ONE allowlisted shell-selection root web-app/index.tsx (it reaches a backend only
// via shell-branched dynamic imports). A short allowlist covers the legitimately-guarded main-only process reads.
//
// Run: `node support/audit-shared.mjs` (also `yarn audit:shared`). Exits non-zero on any violation.
//
// NOTE: this is Node TOOLING (like support/watch.mjs / support/cdp.mjs), NOT src/ app code — a leak-audit that
// parses the project's TypeScript necessarily runs in Node. It is never bundled; the "no node in shared code"
// rule it enforces is scoped to src/. It imports only node:path + the typescript compiler API.

import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");

// A file is a BACKEND (may use node/electron/@tauri) when it lives under one of these.
const BACKEND_DIRS = ["src/platform/electron/", "src/platform/tauri/"];
// Reached by a shell-branched DYNAMIC import only — the single allowed shared→backend seam.
const ALLOWLISTED_FILES = ["src/web-app/index.tsx"];
// Legitimately-guarded main-only `process` reads (renderer-safe via `typeof process !== "undefined"`).
const PROCESS_ALLOWLIST = ["src/container-client/mock/mode.ts", "src/container-client/remote-env.ts"];

// Forbidden module specifiers (import statements). node-coupled 3rd-party deps included per the criterion.
const FORBIDDEN_IMPORT = /^(node:|electron$|electron\/|@tauri-apps\/|undici$|ssh-config$|fix-path$|electron-log)/;
// Runtime globals a shared file must not touch in value position (type-only NodeJS.ProcessEnv etc. are fine).
const FORBIDDEN_GLOBALS = new Set(["process", "Buffer", "__dirname", "__filename"]);

function rel(file) {
  return path.relative(ROOT, file.replace(/\\/g, "/")).split(path.sep).join("/");
}
function isTest(r) {
  return /\.test\.tsx?$/.test(r) || /\.live\.tsx?$/.test(r) || r.startsWith("src/__tests__/");
}
function isBackend(r) {
  return BACKEND_DIRS.some((d) => r.startsWith(d));
}

// Build a full Program so a `process`/`Buffer` identifier can be resolved to its SYMBOL — that is the only way to
// tell the ambient Node global (declared in @types/node, a leak) from a LOCAL named `process` (e.g. the destructured
// `{ process, child }` CommandExecutionResult in runner/services — not a leak). Heuristic scope checks can't.
const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

// True when the identifier resolves to the ambient global (no declaration inside src/) rather than a local binding.
function isAmbientGlobal(node) {
  let sym = checker.getSymbolAtLocation(node);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const decls = sym?.declarations ?? [];
  if (decls.length === 0) return true; // unresolved → conservatively a global
  return !decls.some((d) => rel(d.getSourceFile().fileName).startsWith("src/"));
}

const violations = [];

for (const src of program.getSourceFiles()) {
  const r = rel(src.fileName);
  if (!r.startsWith("src/") || isBackend(r) || isTest(r) || ALLOWLISTED_FILES.includes(r)) continue;

  const processOk = PROCESS_ALLOWLIST.includes(r);
  const at = (node) => src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node) => {
    // Static import / re-export specifiers.
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec) && FORBIDDEN_IMPORT.test(spec.text)) {
        violations.push({ r, line: at(spec), msg: `imports "${spec.text}"` });
      }
    }
    // Dynamic import().
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && FORBIDDEN_IMPORT.test(arg.text)) {
        violations.push({ r, line: at(arg), msg: `dynamic-imports "${arg.text}"` });
      }
    }
    // Value-position use of a forbidden runtime global (type-only NodeJS.* references resolve to types, not here).
    if (
      !processOk &&
      ts.isIdentifier(node) &&
      FORBIDDEN_GLOBALS.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      isAmbientGlobal(node)
    ) {
      violations.push({ r, line: at(node), msg: `uses global \`${node.text}\`` });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

if (violations.length === 0) {
  console.log("✓ audit-shared: no node/electron/@tauri leaks in shared code");
  process.exit(0);
}
console.error(`✗ audit-shared: ${violations.length} violation(s) in shared code:\n`);
for (const v of violations.sort((a, b) => a.r.localeCompare(b.r) || a.line - b.line)) {
  console.error(`  ${v.r}:${v.line}  ${v.msg}`);
}
process.exit(1);
