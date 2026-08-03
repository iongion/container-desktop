// Guards C3: the DEV/TEST-only AI mock module (scripted model, mock prompts, in-memory permission store) must
// never ship in a production build. createAISystem loads it via a dynamic import gated on
// `import.meta.env.ENVIRONMENT !== "production"`, so a production bundle statically drops that branch. Run this
// after `ENVIRONMENT=production yarn build`; it fails if any known aiMocks marker survives in build/**.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Scan only the current version's output (build/<version>/) so stale prior-version build dirs never false-positive.
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const BUILD_DIR = join("build", version);
// Markers unique to src/ai-system/testing/aiMocks.ts and the mock prompt templates it imports.
const MARKERS = ["mock-assistant", "Mock model failure", "createMockAIDeps"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(c?js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

let files;
try {
  files = walk(BUILD_DIR);
} catch {
  console.error(`verify:no-mocks — no ${BUILD_DIR}/ directory. Run \`ENVIRONMENT=production yarn build\` first.`);
  process.exit(2);
}

let leaked = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const hits = MARKERS.filter((marker) => text.includes(marker));
  if (hits.length > 0) {
    leaked = true;
    console.error(`MOCK LEAK in ${file}: ${hits.join(", ")}`);
  }
}

if (leaked) {
  console.error("verify:no-mocks FAILED — AI mocks leaked into the production build.");
  process.exit(1);
}
console.log(`verify:no-mocks OK — scanned ${files.length} build artifacts, no AI mock markers found.`);
