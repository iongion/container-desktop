import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json");
const releaseArtifacts = require("../../support/release-artifacts.cjs");
const store = require("../../support/tauri-win-store.cjs");

const pkg = {
  name: "container-desktop",
  desktopName: "container-desktop",
  title: "Container Desktop",
  version: "5.3.18",
  author: "Ionut Stoica",
  description: "Container Desktop",
};

describe("Tauri Windows Store packaging", () => {
  it("keeps the Tauri Store identity aligned with Electron AppX identity", () => {
    const plan = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      format: "msix",
      buildNumber: 0,
    });

    expect(path.basename(plan.outputPath)).toBe("container-desktop-x64-5.3.18.msix");
    expect(plan.identityName).toBe("IonutStoica.ContainerDesktop");
    expect(plan.publisher).toBe("CN=Ionut.Stoica");
    expect(plan.publisherDisplayName).toBe("Ionut Stoica");
    expect(plan.packageVersion).toBe("5.3.18.0");
    expect(plan.exeName).toBe("container-desktop.exe");
  });

  it("keeps the Windows Store package revision at zero like electron-builder AppX", () => {
    const plan = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      format: "appx",
      buildNumber: 42,
    });

    expect(plan.packageVersion).toBe("5.3.18.0");
    expect(plan.manifest).toContain('Version="5.3.18.0"');
  });

  it("defaults direct Tauri Store plans to AppX for Electron artifact parity", () => {
    const plan = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
    });

    expect(plan.format).toBe("appx");
    expect(path.basename(plan.outputPath)).toBe("container-desktop-x64-5.3.18.appx");
    expect(plan.manifestPath).toBe("/repo/release/tauri-win-store/x64/AppxManifest.xml");
  });

  it("generates a full-trust Windows Desktop manifest with the same capabilities and tiles Electron adds", () => {
    const manifest = store.createStoreManifest({
      pkg,
      arch: "x64",
      buildNumber: 0,
    });

    expect(manifest).toMatch(/<Identity\s+Name="IonutStoica\.ContainerDesktop"/);
    expect(manifest).toContain('Publisher="CN=Ionut.Stoica"');
    expect(manifest).toContain('Version="5.3.18.0"');
    expect(manifest).toContain('ProcessorArchitecture="x64"');
    expect(manifest).toContain("<Description>Container Desktop</Description>");
    expect(manifest).toContain('Language="en-US"');
    expect(manifest).toContain('Executable="container-desktop.exe"');
    expect(manifest).toContain('EntryPoint="Windows.FullTrustApplication"');
    expect(manifest).toContain('Wide310x150Logo="assets\\Wide310x150Logo.png"');
    expect(manifest).toContain('Square71x71Logo="assets\\SmallTile.png"');
    expect(manifest).toContain('Square310x310Logo="assets\\LargeTile.png"');
    expect(manifest).toMatch(/<Capability Name="internetClient" ?\/>/);
    expect(manifest).toMatch(/<Capability Name="privateNetworkClientServer" ?\/>/);
    expect(manifest).toMatch(/<rescap:Capability Name="runFullTrust" ?\/>/);
  });

  it("stages the Tauri executable and Microsoft Store icons from the Electron AppX branding set", () => {
    const plan = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      format: "msix",
    });

    expect(plan.files.map((file: { destination: string }) => file.destination)).toEqual([
      "/repo/release/tauri-win-store/x64/container-desktop.exe",
      "/repo/release/tauri-win-store/x64/assets/StoreLogo.png",
      "/repo/release/tauri-win-store/x64/assets/Square150x150Logo.png",
      "/repo/release/tauri-win-store/x64/assets/Square44x44Logo.png",
      "/repo/release/tauri-win-store/x64/assets/Wide310x150Logo.png",
      "/repo/release/tauri-win-store/x64/assets/SmallTile.png",
      "/repo/release/tauri-win-store/x64/assets/LargeTile.png",
    ]);
    expect(plan.files.map((file: { source: string }) => file.source)).toContain(
      "/repo/src-tauri/target/x86_64-pc-windows-msvc/release/container-desktop.exe",
    );
    expect(plan.files.map((file: { source: string }) => file.source)).toContain(
      "/repo/src/resources/appx/Square150x150Logo.png",
    );
    expect(plan.files.map((file: { source: string }) => file.source)).toContain(
      "/repo/src/resources/appx/Wide310x150Logo.png",
    );
  });

  it("uses Microsoft winapp for MSIX and the winapp-hosted MakeAppx tool for literal AppX", () => {
    const msix = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      format: "msix",
    });
    const appx = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      format: "appx",
    });

    expect(msix.packCommand).toEqual({
      command: "winapp",
      args: [
        "pack",
        "/repo/release/tauri-win-store/x64",
        "--manifest",
        "/repo/release/tauri-win-store/x64/Package.appxmanifest",
        "--output",
        "/repo/release/container-desktop-x64-5.3.18.msix",
        "--executable",
        "container-desktop.exe",
      ],
    });
    expect(appx.packCommand).toEqual({
      command: "winapp",
      args: [
        "tool",
        "makeappx",
        "pack",
        "/d",
        "/repo/release/tauri-win-store/x64",
        "/p",
        "/repo/release/container-desktop-x64-5.3.18.appx",
        "/o",
      ],
    });
  });

  it("builds Windows Store ARM64 packages with ARM64 identity and filenames", () => {
    const plan = store.createStorePackagePlan({
      projectRoot: "/repo",
      releaseDir: "/repo/release",
      pkg,
      arch: "arm64",
      target: "aarch64-pc-windows-msvc",
      format: "msix",
      buildNumber: 0,
    });

    expect(plan.target).toBe("aarch64-pc-windows-msvc");
    expect(plan.manifest).toContain('ProcessorArchitecture="arm64"');
    expect(path.basename(plan.outputPath)).toBe("container-desktop-arm64-5.3.18.msix");
    expect(plan.files.map((file: { source: string }) => file.source)).toContain(
      "/repo/src-tauri/target/aarch64-pc-windows-msvc/release/container-desktop.exe",
    );
  });

  it("exposes explicit Tauri Store package scripts with AppX as the Electron-parity default", () => {
    expect(rootPkg.scripts["package:tauri:win_store"]).toBe("yarn package:tauri:win_store:appx");
    expect(rootPkg.scripts["package:tauri:win_store:msix"]).toContain("node support/tauri-win-store.cjs pack");
    expect(rootPkg.scripts["package:tauri:win_store:msix"]).toContain("--format msix");
    expect(rootPkg.scripts["package:tauri:win_store:msix:arm64"]).toContain("--arch arm64");
    expect(rootPkg.scripts["package:tauri:win_store:appx"]).toContain("node support/tauri-win-store.cjs pack");
    expect(rootPkg.scripts["package:tauri:win_store:appx"]).toContain("--format appx");
    expect(rootPkg.scripts["package:tauri:win_store:appx:arm64"]).toContain("--arch arm64");
  });

  it("keeps generated Windows Store packages private in GitHub releases", () => {
    const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-desktop-release-"));
    try {
      for (const name of [
        "container-desktop-x64-5.3.18.appx",
        "container-desktop-arm64-5.3.18.appx",
        "container-desktop-x64-5.3.18.msix",
        "container-desktop-arm64-5.3.18.msix",
        "container-desktop-x64-5.3.18.zip",
        "container-desktop-arm64-5.3.18.zip",
      ]) {
        fs.writeFileSync(path.join(releaseDir, name), "asset");
      }

      expect(
        releaseArtifacts.publicReleaseAssets(releaseDir, "5.3.18").map((asset: string) => path.basename(asset)),
      ).toEqual(["container-desktop-arm64-5.3.18.zip", "container-desktop-x64-5.3.18.zip"]);
      expect(releaseArtifacts.skippedReleaseAssets(releaseDir, "5.3.18")).toEqual(
        expect.arrayContaining([
          "container-desktop-arm64-5.3.18.appx",
          "container-desktop-arm64-5.3.18.msix",
          "container-desktop-x64-5.3.18.appx",
          "container-desktop-x64-5.3.18.msix",
        ]),
      );
    } finally {
      fs.rmSync(releaseDir, { recursive: true, force: true });
    }
  });
});
