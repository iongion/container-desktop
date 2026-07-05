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
  it("defaults to electron when unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveCaptureBackend()).toBe("electron");
  });

  it("reads the env var (case-insensitive)", () => {
    process.env[ENV_KEY] = "TAURI";
    expect(resolveCaptureBackend()).toBe("tauri");
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
  it("keeps the electron screenshot dir on the published website path", () => {
    expect(screenshotOutDir("electron")).toBe(path.join(PROJECT_HOME, "website-src", "static", "img"));
  });

  it("routes tauri screenshots to the capture artifacts", () => {
    expect(screenshotOutDir("tauri")).toBe(path.join(PROJECT_HOME, "webdriver", "artifacts", "capture", "screenshots"));
  });

  it("writes electron demo output in place", () => {
    expect(demoOutputPath("electron", "website-src/static/replays/podman.json")).toBe(
      path.join(PROJECT_HOME, "website-src/static/replays/podman.json"),
    );
  });

  it("re-roots tauri demo output under the capture artifacts, stripping the website prefix", () => {
    expect(demoOutputPath("tauri", "website-src/static/replays/podman.json")).toBe(
      path.join(PROJECT_HOME, "webdriver", "artifacts", "capture", "replays", "podman.json"),
    );
    expect(demoOutputPath("tauri", "website-src/static/videos/unified.png")).toBe(
      path.join(PROJECT_HOME, "webdriver", "artifacts", "capture", "videos", "unified.png"),
    );
  });
});
