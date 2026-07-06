// @vitest-environment node
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { demoOutputPath, resolveCaptureBackend, screenshotOutDir } from "./backend";

const ENV_KEY = "CONTAINER_DESKTOP_CAPTURE_BACKEND";
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = original;
  }
});

describe("resolveCaptureBackend", () => {
  it("defaults to tauri (webdriver) when unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveCaptureBackend()).toBe("tauri");
  });

  it("reads the env var (case-insensitive)", () => {
    process.env[ENV_KEY] = "ELECTRON";
    expect(resolveCaptureBackend()).toBe("electron");
  });

  it("prefers an explicit override over the env var", () => {
    process.env[ENV_KEY] = "tauri";
    expect(resolveCaptureBackend("electron")).toBe("electron");
  });

  it("throws on an unknown backend", () => {
    expect(() => resolveCaptureBackend("chromium")).toThrow(/unknown capture backend/i);
  });
});

describe("output routing", () => {
  it("writes screenshots to the published website images regardless of backend", () => {
    expect(screenshotOutDir()).toBe(path.join(PROJECT_HOME, "website-src", "static", "img"));
  });

  it("writes demo output in place at the published path regardless of backend", () => {
    expect(demoOutputPath("website-src/static/replays/podman.json")).toBe(
      path.join(PROJECT_HOME, "website-src/static/replays/podman.json"),
    );
    expect(demoOutputPath("website-src/static/videos/unified.png")).toBe(
      path.join(PROJECT_HOME, "website-src/static/videos/unified.png"),
    );
  });
});
