import { configDefaults, defineConfig } from "vitest/config";
import { makeAliases } from "./support/aliases.mjs";

// LIVE connectivity suite — runs against the owner's real machines (see src/__tests__/live). Kept in a
// separate project so it never runs in the hermetic/CI run. Select targets with
// CONTAINER_DESKTOP_TEST_TARGETS=<id,...>; unconfigured combos are skipped loudly.
export default defineConfig({
  resolve: {
    alias: makeAliases(new URL(".", import.meta.url).pathname),
  },
  test: {
    include: ["src/**/*.live.test.{ts,tsx}"],
    // The UI suite (Electron/CDP) has its own project (vitest.ui.config.mts) — keep it out of here.
    exclude: [...configDefaults.exclude, "src/__tests__/ui/**"],
    environment: "node",
    // Wire the platform globals (Platform/Path/FS/CURRENT_OS_TYPE). Tests opt into the real spawning
    // Command via installRealCommand() from the same module.
    setupFiles: ["src/__tests__/setup/headless.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globals: false,
  },
});
