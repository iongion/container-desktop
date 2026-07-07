import { describe, expect, it } from "vitest";

// ELECTRON_CD_JOBS (support/build-matrix.cjs) is the source of truth for CDPipeline.Electron.yml. Guard it:
// every job's packageScript must be a real package.json script, and the set must stay the authentic
// Electron matrix (4 targets across all of 5.x — no Windows-on-ARM, no Intel mac).
const matrix = require("../../build-matrix.cjs");
const pkg = require("../../../package.json");

describe("ELECTRON_CD_JOBS", () => {
  it("references package:electron:* scripts that exist in package.json", () => {
    for (const job of matrix.ELECTRON_CD_JOBS) {
      expect(job.packageScript, job.target).toMatch(/^package:electron:/);
      expect(Object.keys(pkg.scripts), job.packageScript).toContain(job.packageScript);
    }
  });

  it("is the authentic 4-target set (linux x64/arm64, macos arm64, windows x64 — no win-arm, no intel-mac)", () => {
    const targets = matrix.ELECTRON_CD_JOBS.map((j: { target: string }) => j.target).sort();
    expect(targets).toEqual(["linux-arm64", "linux-x64", "macos-arm64", "windows-x64"]);
  });

  it("carries no rustTarget (Electron has no Rust step, unlike the Tauri CD_JOBS)", () => {
    for (const job of matrix.ELECTRON_CD_JOBS) {
      expect(job.rustTarget, job.target).toBeUndefined();
    }
  });

  it("electronCdJobsForTarget filters by all / os-family / exact target", () => {
    expect(matrix.electronCdJobsForTarget("all")).toHaveLength(4);
    expect(matrix.electronCdJobsForTarget()).toHaveLength(4);
    expect(
      matrix
        .electronCdJobsForTarget("linux")
        .map((j: { target: string }) => j.target)
        .sort(),
    ).toEqual(["linux-arm64", "linux-x64"]);
    expect(matrix.electronCdJobsForTarget("windows")).toHaveLength(1);
    expect(matrix.electronCdJobsForTarget("macos-arm64")).toEqual([
      matrix.ELECTRON_CD_JOBS.find((j: { target: string }) => j.target === "macos-arm64"),
    ]);
  });

  it("every OS runner is distinct per target (native per-OS packaging)", () => {
    const byTarget = Object.fromEntries(
      matrix.ELECTRON_CD_JOBS.map((j: { target: string; os: string }) => [j.target, j.os]),
    );
    expect(byTarget["linux-x64"]).toMatch(/ubuntu/);
    expect(byTarget["macos-arm64"]).toMatch(/macos/);
    expect(byTarget["windows-x64"]).toMatch(/windows/);
  });
});
