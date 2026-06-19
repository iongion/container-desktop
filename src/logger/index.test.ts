import { afterEach, describe, expect, it, vi } from "vitest";

import { __setLoggerLevelForTests, createLogger, normalizeLogLevel } from "./index";

describe("createLogger", () => {
  afterEach(() => {
    __setLoggerLevelForTests("warn");
    vi.restoreAllMocks();
  });

  it("filters debug output below the configured level", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logger = createLogger("test.logger");

    __setLoggerLevelForTests("warn");
    logger.debug("hidden");
    logger.warn("visible");

    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[test.logger]", "visible");
  });

  it("allows debug output when explicitly enabled", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const logger = createLogger("test.logger");

    __setLoggerLevelForTests("debug");
    logger.debug("visible");

    expect(debug).toHaveBeenCalledWith("[test.logger]", "visible");
  });

  it("normalizes unsupported levels back to warn", () => {
    expect(normalizeLogLevel("trace")).toBe("debug");
    expect(normalizeLogLevel("warning")).toBe("warn");
    expect(normalizeLogLevel("wat")).toBe("warn");
  });
});
