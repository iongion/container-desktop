import { afterEach, describe, expect, it } from "vitest";

import { __setLoggerLevelForTests, createLogger, registerLoggerBackend } from "@/platform/logger";

afterEach(() => registerLoggerBackend(null));

// Proves the persistence backend is swappable behind the @/platform/logger port (the Tauri seam): a fake backend
// receives the same level-gated records the console does, and detaching restores console-only behavior —
// all without changing any call site.
describe("logger backend port", () => {
  it("forwards already level-gated records to a registered backend; null restores console-only", () => {
    __setLoggerLevelForTests("warn");
    const records: Array<{ level: string; scope: string; args: unknown[] }> = [];
    registerLoggerBackend({ write: (level, scope, args) => records.push({ level, scope, args }) });

    const logger = createLogger("test.scope");
    logger.error("boom", 1);
    logger.warn("careful");
    logger.info("filtered"); // below warn → never reaches the backend

    expect(records).toEqual([
      { level: "error", scope: "test.scope", args: ["boom", 1] },
      { level: "warn", scope: "test.scope", args: ["careful"] },
    ]);

    registerLoggerBackend(null);
    records.length = 0;
    logger.error("after-detach");
    expect(records).toEqual([]); // no backend installed → console only
  });
});
