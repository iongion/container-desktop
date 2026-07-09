import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json");
const tauriBuild = require("../../support/tauri-build.cjs");
const projectRoot = path.resolve(__dirname, "../..");

describe("Tauri build command planning", () => {
  it("adds cargo-xwin for Windows MSVC builds from non-Windows hosts", () => {
    const command = tauriBuild.createTauriBuildCommand({
      args: ["build", "--no-bundle", "--target", "x86_64-pc-windows-msvc"],
      hostPlatform: "linux",
      commandExists: (name: string) => name === "cargo-xwin",
    });

    expect(command.args).toEqual([
      "build",
      "--runner",
      "cargo-xwin",
      "--no-bundle",
      "--target",
      "x86_64-pc-windows-msvc",
    ]);
  });

  it("keeps Windows MSVC builds native on Windows hosts", () => {
    const command = tauriBuild.createTauriBuildCommand({
      args: ["build", "--target", "x86_64-pc-windows-msvc"],
      hostPlatform: "win32",
      commandExists: () => false,
    });

    expect(command.args).toEqual(["build", "--target", "x86_64-pc-windows-msvc"]);
  });

  it("runs local Windows cmd shims through a shell", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-build-"));
    fs.mkdirSync(path.join(tempRoot, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "node_modules", ".bin", "tauri.cmd"), "@echo off\n");

    const command = tauriBuild.createTauriBuildCommand({
      args: ["build"],
      hostPlatform: "win32",
      projectRoot: tempRoot,
      commandExists: () => false,
    });

    expect(command.command).toBe(path.join(tempRoot, "node_modules", ".bin", "tauri.cmd"));
    expect(command.spawnOptions).toEqual({ shell: true });
  });

  it("respects an explicit runner", () => {
    const command = tauriBuild.createTauriBuildCommand({
      args: ["build", "--runner", "custom-runner", "--target", "x86_64-pc-windows-msvc"],
      hostPlatform: "linux",
      commandExists: (name: string) => name === "cargo-xwin",
    });

    expect(command.args).toEqual(["build", "--runner", "custom-runner", "--target", "x86_64-pc-windows-msvc"]);
  });

  it("fails early when cargo-xwin is missing for non-Windows MSVC builds", () => {
    expect(() =>
      tauriBuild.createTauriBuildCommand({
        args: ["build", "--target", "x86_64-pc-windows-msvc"],
        hostPlatform: "linux",
        commandExists: () => false,
      }),
    ).toThrow(/cargo-xwin/);
  });

  it("keeps Linux ARM64 builds native on ARM64 Linux hosts", () => {
    const command = tauriBuild.createTauriBuildCommand({
      args: ["build", "--target", "aarch64-unknown-linux-gnu"],
      hostPlatform: "linux",
      hostArch: "arm64",
      commandExists: () => false,
      pathExists: () => false,
    });

    expect(command.args).toEqual(["build", "--target", "aarch64-unknown-linux-gnu"]);
    expect(command.env).toBeUndefined();
  });

  it("rejects Linux ARM64 host cross-builds from x64 Linux", () => {
    expect(() =>
      tauriBuild.createTauriBuildCommand({
        args: ["build", "--target", "aarch64-unknown-linux-gnu"],
        hostPlatform: "linux",
        hostArch: "x64",
        commandExists: () => true,
        pathExists: () => true,
      }),
    ).toThrow(/Docker container, CI ARM64 runner, or native ARM64 Linux host/);
  });

  it("routes Windows Tauri package scripts through the cross-host build wrapper", () => {
    expect(rootPkg.scripts["package:tauri:win_nsis:x64"]).toContain(
      "node support/tauri-build.cjs build --bundles nsis",
    );
    expect(rootPkg.scripts["package:tauri:win_nsis:arm64"]).toContain("--target aarch64-pc-windows-msvc");
    expect(rootPkg.scripts["package:tauri:win_zip:x64"]).toContain("node support/tauri-build.cjs build --no-bundle");
    expect(rootPkg.scripts["package:tauri:win_zip:arm64"]).toContain("--target aarch64-pc-windows-msvc");
    expect(rootPkg.scripts["package:tauri:win_store:appx"]).toContain("node support/tauri-build.cjs build --no-bundle");
    expect(rootPkg.scripts["package:tauri:win_store:appx:arm64"]).toContain("--target aarch64-pc-windows-msvc");
    expect(rootPkg.scripts["package:tauri:win_store:msix"]).toContain("node support/tauri-build.cjs build --no-bundle");
    expect(rootPkg.scripts["package:tauri:win_store:msix:arm64"]).toContain("--target aarch64-pc-windows-msvc");
  });

  it("compiles the Windows app once per aggregate, then packages every format from that one build", () => {
    for (const { script, triple } of [
      { script: "package:tauri:win_x64", triple: "x86_64-pc-windows-msvc" },
      { script: "package:tauri:win_arm", triple: "aarch64-pc-windows-msvc" },
    ]) {
      const value = rootPkg.scripts[script];
      expect(value.match(/yarn tauri:renderer/g) ?? []).toHaveLength(1);
      expect(value.match(/tauri-build\.cjs build/g) ?? []).toHaveLength(1);
      expect(value).toContain(`--bundles nsis --target ${triple}`);
      // All four Windows artifacts produced from that single build, reusing the compiled exe.
      expect(value).toContain("tauri-native-bundles.cjs collect");
      expect(value).toContain("tauri-win-store.cjs pack --format appx");
      expect(value).toContain("tauri-win-store.cjs pack --format msix");
      expect(value).toContain("tauri-portable.cjs pack --platform win");
    }
  });

  it("routes Linux ARM64 Tauri package scripts through the cross-host build wrapper", () => {
    expect(rootPkg.scripts["package:tauri:linux_arm"]).toContain(
      "node support/tauri-build.cjs build --target aarch64-unknown-linux-gnu",
    );
    expect(rootPkg.scripts["package:tauri:linux_tgz:arm64"]).toContain(
      "node support/tauri-build.cjs build --no-bundle --target aarch64-unknown-linux-gnu",
    );
  });

  it("keeps local dependency provisioning free of Linux ARM64 host cross-build automation", () => {
    const script = fs.readFileSync(path.join(projectRoot, "support/provision-deps.sh"), "utf8");

    expect(script).not.toContain("linux-arm64-cross");
    expect(script).not.toContain("dpkg --add-architecture arm64");
    expect(script).not.toContain("aarch64-linux-gnu");
    expect(script).not.toContain(":arm64");
  });
});
