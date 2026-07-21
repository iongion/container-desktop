import { configDefaults, defineConfig } from "vitest/config";
import { makeAliases } from "./support/aliases.mjs";

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
    include: ["src/**/*.{test,spec}.{ts,tsx}", "support/**/*.{test,spec}.{ts,tsx}"],
    // `*.live.test.ts` also ends in `.test.ts`, so it WOULD match the include glob — exclude it
    // explicitly so the real-VM suite never runs in the hermetic/CI run.
    exclude: [...configDefaults.exclude, "src/**/*.live.test.{ts,tsx}"],
    // Wire the headless platform globals (Platform/Path/FS/CURRENT_OS_TYPE) the container-client
    // layer reads. Tests that exercise Command install a recording fake (setup/fakeCommand.ts).
    setupFiles: ["src/__tests__/setup/headless.ts"],
    // Tests import { describe, it, expect } from "vitest" (globals disabled → no tsconfig types change needed).
    globals: false,
    clearMocks: true,
  },
});
