import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json");
const portable = require("../../support/tauri-portable.cjs");

const pkg = {
  name: "container-desktop",
  desktopName: "container-desktop",
  title: "Container Desktop",
  version: "5.3.18",
  author: "Ionut Stoica",
  description: "Container Desktop",
};

describe("Tauri portable package parity", () => {
  it("plans the Windows portable zip using Electron's public artifact name", () => {
    const plan = portable.createPortablePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "win",
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      hostPlatform: "win32",
    });
    const armPlan = portable.createPortablePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "win",
      arch: "arm64",
      target: "aarch64-pc-windows-msvc",
      hostPlatform: "win32",
    });

    expect(path.basename(plan.outputPath)).toBe("container-desktop-x64-5.3.18.zip");
    expect(path.basename(armPlan.outputPath)).toBe("container-desktop-arm64-5.3.18.zip");
    expect(plan.files).toEqual([
      {
        source: "/repo/src-tauri/target/x86_64-pc-windows-msvc/release/container-desktop.exe",
        destination: "/repo/release/tauri-portable/win-x64/container-desktop/container-desktop.exe",
      },
      {
        source: "/repo/LICENSE",
        destination: "/repo/release/tauri-portable/win-x64/container-desktop/LICENSE",
      },
    ]);
    expect(armPlan.files[0]).toEqual({
      source: "/repo/src-tauri/target/aarch64-pc-windows-msvc/release/container-desktop.exe",
      destination: "/repo/release/tauri-portable/win-arm64/container-desktop/container-desktop.exe",
    });
    expect(plan.archiveCommand.command).toBe("powershell");
    expect(plan.archiveCommand.args.join(" ")).toContain("Compress-Archive");
  });

  it("plans the macOS portable tarball from the Tauri app bundle", () => {
    const plan = portable.createPortablePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "mac",
      arch: "arm64",
      target: "aarch64-apple-darwin",
    });

    expect(path.basename(plan.outputPath)).toBe("container-desktop-mac-arm64-5.3.18.tar.gz");
    expect(plan.files[0]).toEqual({
      source: "/repo/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Container Desktop.app",
      destination: "/repo/release/tauri-portable/mac-arm64/Container Desktop.app",
    });
    expect(plan.archiveCommand).toEqual({
      command: "tar",
      args: [
        "-czf",
        "/repo/release/container-desktop-mac-arm64-5.3.18.tar.gz",
        "-C",
        "/repo/release/tauri-portable/mac-arm64",
        ".",
      ],
    });
  });

  it("plans Linux portable tarballs with Electron's arch tokens", () => {
    const x64 = portable.createPortablePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "linux",
      arch: "x64",
      target: "x86_64-unknown-linux-gnu",
    });
    const arm64 = portable.createPortablePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "linux",
      arch: "arm64",
      target: "aarch64-unknown-linux-gnu",
    });

    expect(path.basename(x64.outputPath)).toBe("container-desktop-linux-x64-5.3.18.tar.gz");
    expect(path.basename(arm64.outputPath)).toBe("container-desktop-linux-arm64-5.3.18.tar.gz");
    expect(x64.files[0]).toEqual({
      source: "/repo/src-tauri/target/x86_64-unknown-linux-gnu/release/container-desktop",
      destination: "/repo/release/tauri-portable/linux-x64/container-desktop/container-desktop",
    });
  });

  it("exposes Tauri portable scripts for the zip and tar.gz artifacts", () => {
    expect(rootPkg.scripts["package:tauri:win_x64"]).toContain(
      "node support/tauri-portable.cjs pack --platform win --arch x64",
    );
    expect(rootPkg.scripts["package:tauri:win_arm"]).toContain(
      "node support/tauri-portable.cjs pack --platform win --arch arm64",
    );
    expect(rootPkg.scripts["package:tauri:mac_arm"]).toContain("tauri build --target aarch64-apple-darwin");
    expect(rootPkg.scripts["package:tauri:mac_arm"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:linux_x86"]).toContain("tauri build --target x86_64-unknown-linux-gnu");
    expect(rootPkg.scripts["package:tauri:linux_x86"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:linux_arm"]).toContain(
      "node support/tauri-build.cjs build --target aarch64-unknown-linux-gnu",
    );
    expect(rootPkg.scripts["package:tauri:linux_arm"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:win_zip:x64"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:win_zip:x64"]).toContain("--platform win");
    expect(rootPkg.scripts["package:tauri:win_zip:arm64"]).toContain("--arch arm64");
    expect(rootPkg.scripts["package:tauri:mac_tgz"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:mac_tgz"]).toContain("--platform mac");
    expect(rootPkg.scripts["package:tauri:linux_tgz:x64"]).toContain("node support/tauri-portable.cjs pack");
    expect(rootPkg.scripts["package:tauri:linux_tgz:x64"]).toContain("--platform linux");
    expect(rootPkg.scripts["package:tauri:linux_tgz:arm64"]).toContain("--arch arm64");
  });
});
