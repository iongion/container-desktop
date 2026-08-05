import { availableParallelism } from "node:os";
import { configDefaults, defineConfig } from "vitest/config";
import { makeAliases } from "./support/aliases.mjs";

// Half the cores, never all of them. Every worker builds its own jsdom, so an uncapped run on a many-core
// workstation spawns one heavyweight environment per core and takes the whole desktop unresponsive for the length of
// the suite — the machine running the tests is also the machine being worked on. The floor of 2 keeps CI (2 cores)
// exactly as parallel as it was, and VITEST_MAX_WORKERS overrides either way.
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS) || Math.max(2, Math.floor(availableParallelism() / 2));

// Standalone Vitest config for the HERMETIC suite (the app's vite.config.*.mjs are per-target build
// configs; the live matrix runs from vitest.live.config.mts). `@` mirrors the tsconfig path alias.
export default defineConfig({
  resolve: {
    alias: makeAliases(new URL(".", import.meta.url).pathname),
  },
  test: {
    // jsdom covers both pure-function tests (normalizers/comparators) and
    // hook tests (renderHook + QueryClientProvider for the invalidation matrix).
    environment: "jsdom",
    // `webdriver/**` holds the WebDriver harness. Its specs are `*.e2e.js` / `*.smoke.js` and are driven by wdio,
    // never collected here; what this picks up is the harness's own hermetic unit tests (the skip decisions in
    // support/prerequisites.js), which must not need a browser, a machine or a process.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "support/**/*.{test,spec}.{ts,tsx}",
      "webdriver/**/*.{test,spec}.{ts,tsx}",
    ],
    // `*.live.test.ts` also ends in `.test.ts`, so it WOULD match the include glob — exclude it
    // explicitly so the real-VM suite never runs in the hermetic/CI run.
    exclude: [...configDefaults.exclude, "src/**/*.live.test.{ts,tsx}"],
    // Wire the headless platform globals (Platform/Path/FS/CURRENT_OS_TYPE) the container-client
    // layer reads. Tests that exercise Command install a recording fake (setup/fakeCommand.ts).
    setupFiles: ["src/__tests__/setup/headless.ts"],
    // Tests import { describe, it, expect } from "vitest" (globals disabled → no tsconfig types change needed).
    globals: false,
    clearMocks: true,
    maxWorkers,
  },
});
