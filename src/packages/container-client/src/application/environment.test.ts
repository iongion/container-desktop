import { afterEach, describe, expect, it, vi } from "vitest";

// Export-contract: Application.ts must keep re-exporting these (no other importer exercises them,
// so a dropped re-export would otherwise pass build/tests silently).
import {
  detectOperatingSystem as detectViaApplication,
  normalizeAndSortSearchResults,
} from "@/container-client/Application";
import { OperatingSystem } from "@/container-client/types/os";
import { detectOperatingSystem, normalizeEngineThemePreference, normalizeTheme } from "./environment";

describe("normalizeTheme", () => {
  it("maps light variants to bp6-light and everything else to bp6-dark", () => {
    expect(normalizeTheme("light")).toBe("bp6-light");
    expect(normalizeTheme("bp6-light")).toBe("bp6-light");
    expect(normalizeTheme("dark")).toBe("bp6-dark");
    expect(normalizeTheme(undefined)).toBe("bp6-dark");
  });
});

describe("normalizeEngineThemePreference", () => {
  it("keeps valid preferences; a stale 'container' and unknowns normalize to auto", () => {
    expect(normalizeEngineThemePreference("podman")).toBe("podman");
    expect(normalizeEngineThemePreference("docker")).toBe("docker");
    expect(normalizeEngineThemePreference("unified")).toBe("unified");
    expect(normalizeEngineThemePreference("container")).toBe("auto");
    expect(normalizeEngineThemePreference(undefined)).toBe("auto");
  });
});

describe("detectOperatingSystem", () => {
  afterEach(() => vi.unstubAllGlobals());

  const withUserAgent = (userAgent: string) => vi.stubGlobal("navigator", { userAgent });

  it("detects the OS from navigator.userAgent", () => {
    withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(detectOperatingSystem()).toBe(OperatingSystem.Windows);

    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)");
    expect(detectOperatingSystem()).toBe(OperatingSystem.MacOS);

    withUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(detectOperatingSystem()).toBe(OperatingSystem.Linux);

    withUserAgent("something-unrecognized");
    expect(detectOperatingSystem()).toBe(OperatingSystem.Unknown);
  });
});

describe("Application historical re-exports", () => {
  it("still exposes detectOperatingSystem and normalizeAndSortSearchResults", () => {
    expect(typeof detectViaApplication).toBe("function");
    expect(typeof normalizeAndSortSearchResults).toBe("function");
  });
});
