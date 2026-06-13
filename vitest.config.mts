import { defineConfig } from "vitest/config";

// Standalone Vitest config (the app's vite.config.*.mjs are per-target build configs).
// `@` mirrors the tsconfig path alias (`@/...` -> `src/...`).
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    // jsdom covers both pure-function tests (normalizers/comparators) and
    // hook tests (renderHook + QueryClientProvider for the invalidation matrix).
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Tests import { describe, it, expect } from "vitest" (globals disabled → no tsconfig types change needed).
    globals: false,
    clearMocks: true,
  },
});
