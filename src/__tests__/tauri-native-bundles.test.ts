import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json");
const nativeBundles = require("../../support/tauri-native-bundles.cjs");

const pkg = {
  name: "container-desktop",
  desktopName: "container-desktop",
  title: "Container Desktop",
  version: "5.3.18",
  author: "Ionut Stoica",
  description: "Container Desktop",
};

function loadNativeBundleInternals() {
  const filename = require.resolve("../../support/tauri-native-bundles.cjs");
  const module = {
    exports: {} as {
      __private?: {
        copyNativeBundle(plan: { sourcePath: string; outputPath: string }): void;
      };
    },
  };
  const source = `${fs.readFileSync(filename, "utf8")}\nmodule.exports.__private = { copyNativeBundle };`;
  vm.runInNewContext(
    source,
    {
      Buffer,
      __dirname: path.dirname(filename),
      __filename: filename,
      clearTimeout,
      console,
      exports: module.exports,
      module,
      process,
      require: createRequire(filename),
      setTimeout,
    },
    { filename },
  );
  if (!module.exports.__private) {
    throw new Error("Unable to load tauri-native-bundles internals");
  }
  return module.exports.__private;
}

const linuxOnly = process.platform === "linux" ? it : it.skip;

describe("Tauri native bundle parity", () => {
  it("collects Linux deb/rpm/AppImage into Electron's canonical artifact names", () => {
    const plans = nativeBundles.createNativeBundlePlans({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "linux",
      arch: "x64",
      target: "x86_64-unknown-linux-gnu",
      formats: ["deb", "rpm", "AppImage"],
    });

    expect(plans.map((plan: { outputPath: string }) => path.basename(plan.outputPath))).toEqual([
      "container-desktop-linux-amd64-5.3.18.deb",
      "container-desktop-linux-x86_64-5.3.18.rpm",
      "container-desktop-linux-x86_64-5.3.18.AppImage",
    ]);
    expect(plans.map((plan: { sourcePath: string }) => plan.sourcePath)).toEqual([
      "/repo/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/Container Desktop_5.3.18_amd64.deb",
      "/repo/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/Container Desktop-5.3.18-1.x86_64.rpm",
      "/repo/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/Container Desktop_5.3.18_amd64.AppImage",
    ]);
  });

  it("collects macOS dmg and Windows NSIS exe into Electron's canonical artifact names", () => {
    const dmg = nativeBundles.createNativeBundlePlans({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "mac",
      arch: "arm64",
      target: "aarch64-apple-darwin",
    });
    const nsis = nativeBundles.createNativeBundlePlans({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "win",
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
    });
    const nsisArm = nativeBundles.createNativeBundlePlans({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "win",
      arch: "arm64",
      target: "aarch64-pc-windows-msvc",
    });

    expect(path.basename(dmg[0].outputPath)).toBe("container-desktop-mac-arm64-5.3.18.dmg");
    expect(dmg[0].sourcePath).toBe(
      "/repo/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Container Desktop_5.3.18_aarch64.dmg",
    );
    expect(path.basename(nsis[0].outputPath)).toBe("container-desktop-x64-5.3.18.exe");
    expect(nsis[0].sourcePath).toBe(
      "/repo/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Container Desktop_5.3.18_x64-setup.exe",
    );
    expect(path.basename(nsisArm[0].outputPath)).toBe("container-desktop-arm64-5.3.18.exe");
    expect(nsisArm[0].sourcePath).toBe(
      "/repo/src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/Container Desktop_5.3.18_arm64-setup.exe",
    );
  });

  it("creates a Pacman artifact through a Linux package staging plan", () => {
    const plan = nativeBundles.createNativeBundlePlans({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      platform: "linux",
      arch: "arm64",
      target: "aarch64-unknown-linux-gnu",
      formats: ["pacman"],
    })[0];

    expect(path.basename(plan.outputPath)).toBe("container-desktop-linux-aarch64-5.3.18.pacman");
    expect(plan.packageArch).toBe("aarch64");
    expect(plan.files).toEqual(
      expect.arrayContaining([
        {
          source: "/repo/src-tauri/target/aarch64-unknown-linux-gnu/release/container-desktop",
          destination: "/repo/release/tauri-native/linux-arm64/pacman/pkg/usr/bin/container-desktop",
        },
        {
          source: "/repo/LICENSE",
          destination: "/repo/release/tauri-native/linux-arm64/pacman/pkg/usr/share/licenses/container-desktop/LICENSE",
        },
      ]),
    );
    expect(plan.archiveCommand).toEqual({
      command: "bsdtar",
      args: [
        "--zstd",
        "-cf",
        "/repo/release/container-desktop-linux-aarch64-5.3.18.pacman",
        "-C",
        "/repo/release/tauri-native/linux-arm64/pacman/pkg",
        ".",
      ],
    });
  });

  linuxOnly("replaces an existing executable artifact even when the old file is busy", async () => {
    const { copyNativeBundle } = loadNativeBundleInternals();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-native-bundles-"));
    const sleepSource = ["/usr/bin/sleep", "/bin/sleep"].find((candidate) => fs.existsSync(candidate));
    const trueSource = ["/usr/bin/true", "/bin/true"].find((candidate) => fs.existsSync(candidate));
    if (!sleepSource || !trueSource) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error("This test requires coreutils sleep and true");
    }

    const outputPath = path.join(dir, "sleep");
    const sourcePath = path.join(dir, "container-desktop-linux-x86_64.AppImage");
    fs.copyFileSync(sleepSource, outputPath);
    fs.copyFileSync(trueSource, sourcePath);
    fs.chmodSync(outputPath, 0o755);

    const child = spawn(outputPath, ["10"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      copyNativeBundle({ sourcePath, outputPath });

      expect(fs.statSync(outputPath).size).toBe(fs.statSync(sourcePath).size);
    } finally {
      child.kill("SIGTERM");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes aggregate Tauri package scripts for every Electron artifact family", () => {
    expect(rootPkg.scripts["package:tauri:linux_x86"]).toContain("support/tauri-native-bundles.cjs collect");
    expect(rootPkg.scripts["package:tauri:linux_arm"]).toContain("support/tauri-native-bundles.cjs collect");
    expect(rootPkg.scripts["package:tauri:mac_arm"]).toContain("support/tauri-native-bundles.cjs collect");
    expect(rootPkg.scripts["package:tauri:win_x64"]).toContain("package:tauri:win_nsis:x64");
    expect(rootPkg.scripts["package:tauri:win_x64"]).toContain("package:tauri:win_store:all:x64");
    expect(rootPkg.scripts["package:tauri:win_arm"]).toContain("package:tauri:win_nsis:arm64");
    expect(rootPkg.scripts["package:tauri:win_arm"]).toContain("package:tauri:win_store:all:arm64");
    expect(rootPkg.scripts["package:tauri:win_store:all"]).toContain("package:tauri:win_store:appx");
    expect(rootPkg.scripts["package:tauri:win_store:all"]).toContain("package:tauri:win_store:msix");
  });
});
