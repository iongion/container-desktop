import path from "node:path";

// Single source of truth for the `@/…` → filesystem alias map, shared by vite.config.common.mjs and the
// vitest configs (tsconfig `paths` mirrors this by hand — JSON can't import). Library packages live under
// src/packages/*; the app (web-app) and shared assets (resources) stay at src/. ORDER MATTERS: every specific
// "@/<pkg>" precedes the generic "@" -> src fallback, because @rollup/plugin-alias matching is first-hit.
const PACKAGES = [
  "ai-system",
  "container-client",
  "container-provisioning",
  "host-contract",
  "logger",
  "i18n",
  "platform",
  "template",
  "utils",
];

export function makeAliases(root) {
  const alias = { "@/cli": path.join(root, "support/cli") };
  for (const pkg of PACKAGES) {
    // Proper npm package layout: sources live under <pkg>/src (package.json sits at <pkg>/).
    alias[`@/${pkg}`] = path.join(root, "src/packages", pkg, "src");
  }
  alias["@/resources"] = path.join(root, "src/resources");
  alias["@/web-app"] = path.join(root, "src/web-app");
  alias["@"] = path.join(root, "src");
  return alias;
}
