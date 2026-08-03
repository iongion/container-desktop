import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };

const buildDirectory = path.resolve("build", pkg.version);
const moduleSpecifier = String.raw`(?:from\s*|import\s*\(|require\s*\()\s*["']`;
const forbidden = [
  ["node crypto", new RegExp(`${moduleSpecifier}node:crypto["']`)],
  ["child process", new RegExp(`${moduleSpecifier}(?:node:)?child_process["']`)],
  ["Anthropic SDK", new RegExp(`${moduleSpecifier}@anthropic-ai/sdk["']`)],
  ["OpenAI SDK", new RegExp(`${moduleSpecifier}openai["']`)],
];

function scripts(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return scripts(file);
    return /\.(?:mjs|js)$/.test(entry.name) ? [file] : [];
  });
}

const violations = [];
for (const file of scripts(buildDirectory)) {
  const source = readFileSync(file, "utf8");
  for (const [name, pattern] of forbidden) {
    if (pattern.test(source)) violations.push(`${path.relative(buildDirectory, file)} imports ${name}`);
  }
}

if (violations.length > 0) {
  throw new Error(`OMA webview bundle contains forbidden imports:\n${violations.join("\n")}`);
}

console.log(`OMA webview bundle is clean (${scripts(buildDirectory).length} scripts checked)`);
