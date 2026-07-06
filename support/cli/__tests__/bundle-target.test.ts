import { describe, expect, it } from "vitest";
import { bundleScriptForTarget } from "@/cli/lib/bundle-target";

describe("bundleScriptForTarget", () => {
  it("maps the explicit linux-arm64 target to the tauri arm package script", () => {
    expect(bundleScriptForTarget("linux-arm64")).toBe("package:tauri:linux_arm");
  });

  it("resolves a coarse linux target from the native machine arch", () => {
    expect(bundleScriptForTarget("linux", "Linux", "aarch64")).toBe("package:tauri:linux_arm");
    expect(bundleScriptForTarget("linux", "Linux", "x86_64")).toBe("package:tauri:linux_x86");
  });

  it("maps platform targets to tauri package scripts", () => {
    expect(bundleScriptForTarget("macos")).toBe("package:tauri:mac_arm");
    expect(bundleScriptForTarget("windows-x64")).toBe("package:tauri:win_x64");
    expect(bundleScriptForTarget("windows-arm")).toBe("package:tauri:win_arm");
  });

  it("resolves a coarse windows target from the native machine arch", () => {
    expect(bundleScriptForTarget("windows", "Windows", "ARM64")).toBe("package:tauri:win_arm");
    expect(bundleScriptForTarget("windows", "Windows", "AMD64")).toBe("package:tauri:win_x64");
  });
});
