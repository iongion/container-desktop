import path from "node:path";
import ts from "typescript";
import { PROJECT_HOME } from "@/cli/lib/paths";

// Import-aware leak audit for the platform-ports refactor. Enforces the success criterion: SHARED code — every
// src file OUTSIDE the two backends src/platform/{electron,tauri} — reaches the host only through contract-typed
// ports/globals, never importing node:*/electron/@tauri-apps/a node-coupled dep, and never using
// process/Buffer/__dirname at runtime (type-only is fine). It is AST-based (via the TypeScript parser), so a
// forbidden token inside a string/template/comment is NOT flagged; only real import statements + value-position
// identifiers are. Run via `yarn cli audit-shared` (or `yarn audit:shared`).

const ROOT = PROJECT_HOME;

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

interface Violation {
  r: string;
  line: number;
  msg: string;
}

function rel(file: string): string {
  return path.relative(ROOT, file.replace(/\\/g, "/")).split(path.sep).join("/");
}
function isTest(r: string): boolean {
  return /\.test\.tsx?$/.test(r) || /\.live\.tsx?$/.test(r) || r.startsWith("src/__tests__/");
}
function isBackend(r: string): boolean {
  return BACKEND_DIRS.some((d) => r.startsWith(d));
}

/**
 * Run the shared-code leak audit. Reports to the console and returns the violation count
 * (0 = clean). Called in-process by the `audit-shared` CLI command.
 */
export function auditShared(): number {
  // Build a full Program so a `process`/`Buffer` identifier can be resolved to its SYMBOL — that is the only way to
  // tell the ambient Node global (declared in @types/node, a leak) from a LOCAL named `process` (e.g. the destructured
  // `{ process, child }` CommandExecutionResult in runner/services — not a leak). Heuristic scope checks can't.
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error(`audit-shared: could not find tsconfig.json under ${ROOT}`);
  }
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  // True when the identifier resolves to the ambient global (no declaration inside src/) rather than a local binding.
  const isAmbientGlobal = (node: ts.Node): boolean => {
    let sym = checker.getSymbolAtLocation(node);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decls = sym?.declarations ?? [];
    if (decls.length === 0) return true; // unresolved → conservatively a global
    return !decls.some((d) => rel(d.getSourceFile().fileName).startsWith("src/"));
  };

  const violations: Violation[] = [];

  for (const src of program.getSourceFiles()) {
    const r = rel(src.fileName);
    if (!r.startsWith("src/") || isBackend(r) || isTest(r) || ALLOWLISTED_FILES.includes(r)) continue;

    const processOk = PROCESS_ALLOWLIST.includes(r);
    const at = (node: ts.Node) => src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    const visit = (node: ts.Node) => {
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
    return 0;
  }
  console.error(`✗ audit-shared: ${violations.length} violation(s) in shared code:\n`);
  for (const v of violations.sort((a, b) => a.r.localeCompare(b.r) || a.line - b.line)) {
    console.error(`  ${v.r}:${v.line}  ${v.msg}`);
  }
  return violations.length;
}
