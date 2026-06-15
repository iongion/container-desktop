import { defineConfig } from "vitest/config";

// UI automation project — drives the real Electron app over CDP (Playwright). Separate from the
// hermetic run and from the connection live suite: it launches an actual app window, so it needs a
// production build and a display (or CONTAINER_DESKTOP_HEADLESS=1 + xvfb). Run with `yarn test:ui`.
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/__tests__/ui/**/*.live.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One Electron instance at a time.
    fileParallelism: false,
    globals: false,
  },
});
