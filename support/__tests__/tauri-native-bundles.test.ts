import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createNativeBundlePlans } = require("../tauri-native-bundles.cjs");

const pkg = { name: "container-desktop", title: "Container Desktop", version: "6.0.0" };

function planFor(arch: string, format: string) {
  return createNativeBundlePlans({
    projectRoot: "/proj",
    releaseDir: "/proj/release",
    pkg,
    platform: "linux",
    arch,
    formats: [format],
  })[0];
}

describe("createNativeBundlePlans — AppImage repack plan", () => {
  it("marks the x64 AppImage for a repack with the appimagetool ARCH label", () => {
    const plan = planFor("x64", "AppImage");
    expect(plan.kind).toBe("appimage");
    expect(plan.archLabel).toBe("x86_64");
    expect(plan.sourcePath).toBe(
      "/proj/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/Container Desktop_6.0.0_amd64.AppImage",
    );
    expect(plan.outputPath).toBe("/proj/release/container-desktop-linux-x86_64-6.0.0.AppImage");
    expect(plan.stageDir).toBe("/proj/release/tauri-native/linux-x64/appimage");
  });

  it("uses the aarch64 ARCH label for arm64", () => {
    const plan = planFor("arm64", "AppImage");
    expect(plan.kind).toBe("appimage");
    expect(plan.archLabel).toBe("aarch64");
    expect(plan.outputPath).toBe("/proj/release/container-desktop-linux-arm64-6.0.0.AppImage");
  });

  it("leaves the deb/rpm plans as plain copies", () => {
    expect(planFor("x64", "deb").kind).toBe("copy");
    expect(planFor("x64", "rpm").kind).toBe("copy");
  });
});
