import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const matrix = require("../../support/build-matrix.cjs");
const projectRoot = path.resolve(__dirname, "../..");

const VERSION = "9.9.9";

describe("Tauri release matrix", () => {
  it("assigns every release artifact to Tauri package scripts", () => {
    const entries = matrix.releaseArtifactEntries(VERSION);

    expect(entries).not.toHaveLength(0);
    expect(new Set(entries.map((entry: { runtime: string }) => entry.runtime))).toEqual(new Set(["tauri"]));
    expect(entries.every((entry: { packageScript: string }) => entry.packageScript.startsWith("package:tauri:"))).toBe(
      true,
    );
    expect(entries.map((entry: { fileName: string }) => entry.fileName).sort()).toEqual(matrix.allAssetNames(VERSION));
  });

  it("keeps Windows AppX/MSIX Tauri-owned and private", () => {
    const storeEntries = matrix
      .releaseArtifactEntries(VERSION)
      .filter(
        (entry: { platform: string; format: string }) =>
          entry.platform === "win" && ["appx", "msix"].includes(entry.format),
      );

    expect(storeEntries.map((entry: { runtime: string }) => entry.runtime)).toEqual([
      "tauri",
      "tauri",
      "tauri",
      "tauri",
    ]);
    expect(storeEntries.map((entry: { public: boolean }) => entry.public)).toEqual([false, false, false, false]);
    expect(storeEntries.map((entry: { fileName: string }) => entry.fileName)).toEqual([
      `container-desktop-x64-${VERSION}.appx`,
      `container-desktop-arm64-${VERSION}.appx`,
      `container-desktop-x64-${VERSION}.msix`,
      `container-desktop-arm64-${VERSION}.msix`,
    ]);
    expect(storeEntries.map((entry: { packageScript: string }) => entry.packageScript)).toEqual([
      "package:tauri:win_store:appx",
      "package:tauri:win_store:appx:arm64",
      "package:tauri:win_store:msix",
      "package:tauri:win_store:msix:arm64",
    ]);
  });

  it("uses a native Linux ARM64 CI runner for Tauri ARM releases", () => {
    expect(matrix.cdJobsForTarget("linux").map((job: { target: string }) => job.target)).toEqual([
      "linux-x64",
      "linux-arm64",
    ]);
    expect(matrix.cdJobsForTarget("all").map((job: { target: string }) => job.target)).toEqual([
      "linux-x64",
      "linux-arm64",
      "macos-arm64",
      "windows-x64",
      "windows-arm",
    ]);
    expect(matrix.cdJobsForTarget("linux-arm64")).toEqual([
      {
        target: "linux-arm64",
        os: "ubuntu-24.04-arm",
        rustTarget: "aarch64-unknown-linux-gnu",
        packageScript: "package:tauri:linux_arm",
      },
    ]);
  });

  it("uses explicit Windows x64 and ARM CI targets without a coarse Windows alias", () => {
    expect(matrix.cdJobsForTarget("windows").map((job: { target: string }) => job.target)).toEqual([
      "windows-x64",
      "windows-arm",
    ]);
    expect(matrix.cdJobsForTarget("windows-arm")).toEqual([
      {
        target: "windows-arm",
        os: "windows-11-arm",
        rustTarget: "aarch64-pc-windows-msvc",
        packageScript: "package:tauri:win_arm",
      },
    ]);
  });

  it("wires CD to explicit Tauri package jobs instead of the Electron build/bundle path", () => {
    const workflow = fs.readFileSync(path.join(projectRoot, ".github/workflows/CDPipeline.yml"), "utf8");

    expect(workflow).toContain("- windows-arm");
    expect(workflow).toContain("- windows-x64");
    expect(workflow).not.toContain("- windows\n");
    expect(workflow).toContain("needs: plan-bundle");
    expect(workflow).toContain("matrix.cdJobsForTarget(process.env.TARGET)");
    expect(workflow).toContain("matrix: ${{");
    expect(workflow).toContain("PACKAGE_SCRIPT: ${{");
    expect(workflow).toContain("uv run --locked invoke bundle");
    expect(workflow).not.toContain("uv run --locked invoke build");
    expect(workflow).not.toContain("electron-builder");
  });
});
