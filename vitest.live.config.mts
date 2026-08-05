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
    // The UI suites run on WebDriver (webdriver/specs/) — nothing UI belongs in this project.
    exclude: [...configDefaults.exclude],
    environment: "node",
    // Wire the platform globals (Platform/Path/FS/CURRENT_OS_TYPE). Real-engine work runs inside a shell
    // over WebDriver (webdriver/specs/), so nothing here spawns processes.
    setupFiles: ["src/__tests__/setup/headless.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globals: false,
    // The suite is currently EMPTY: every real-engine and real-model check now runs on WebDriver against the
    // shipped shell (webdriver/specs/). The project stays so a future node-level live test has a home, and
    // vitest.config.mts still excludes the glob — without this, `yarn test:live` would exit non-zero.
    passWithNoTests: true,
  },
});
