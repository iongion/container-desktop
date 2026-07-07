import { describe, expect, it } from "vitest";
import { TARGETS } from "@/cli/lib/wails-package";

// WAILS_CD_JOBS (support/build-matrix.cjs) is the source of truth for CDPipeline.Wails.yml. Guard it against
// drift with the packager's TARGETS: every CI target must be a real packager target, and every packager target
// must be built by some CI job (else a new target silently ships from nobody's runner).
const matrix = require("../../build-matrix.cjs");

describe("WAILS_CD_JOBS", () => {
  it("only references targets that exist in wails-package TARGETS", () => {
    for (const job of matrix.WAILS_CD_JOBS) {
      for (const target of job.targets) {
        expect(Object.keys(TARGETS), `${job.id} → ${target}`).toContain(target);
      }
    }
  });

  it("covers every packager target across all jobs (nothing left unbuilt)", () => {
    const built = new Set(matrix.WAILS_CD_JOBS.flatMap((job: { targets: string[] }) => job.targets));
    expect([...built].sort()).toEqual(Object.keys(TARGETS).sort());
  });

  it("cross-builds Linux + Windows from ONE Linux runner (the Go-over-Rust win)", () => {
    const linuxWin = matrix.WAILS_CD_JOBS.find((j: { id: string }) => j.id === "linux-and-windows");
    expect(linuxWin.os).toMatch(/ubuntu/);
    expect(linuxWin.targets).toEqual(expect.arrayContaining(["linux_x64", "win_x64", "win_arm64"]));
  });

  it("builds the Store appx/msix on native Windows runners (makeappx is Windows-SDK only)", () => {
    const storeJobs = matrix.WAILS_CD_JOBS.filter((j: { formats?: string[] }) => j.formats);
    expect(storeJobs.length).toBeGreaterThan(0);
    for (const job of storeJobs) {
      expect(job.os).toMatch(/windows/);
      expect(job.formats).toEqual(["appx", "msix"]);
    }
    // The x64 + arm64 Store jobs together cover both Windows arches.
    expect(storeJobs.flatMap((j: { targets: string[] }) => j.targets).sort()).toEqual(["win_arm64", "win_x64"]);
  });

  it("wailsCdJobsForTarget filters by id and returns all for 'all'", () => {
    expect(matrix.wailsCdJobsForTarget("all")).toHaveLength(matrix.WAILS_CD_JOBS.length);
    expect(matrix.wailsCdJobsForTarget()).toHaveLength(matrix.WAILS_CD_JOBS.length);
    expect(matrix.wailsCdJobsForTarget("macos-arm64")).toEqual([
      matrix.WAILS_CD_JOBS.find((j: { id: string }) => j.id === "macos-arm64"),
    ]);
  });

  it("exposes the wails runtime token", () => {
    expect(matrix.RUNTIME.wails).toBe("wails");
  });
});
