import { describe, expect, it } from "vitest";
import { artifactName, macInfoPlist, nsisScript, TARGETS } from "@/cli/lib/wails-package";

// Locks the Wails artifact names to the canonical release/website scheme (release-artifacts.cjs), which uses
// PER-FORMAT arch tokens — deb=amd64, rpm=x86_64/aarch64, tar.gz/zip=x64/arm64, AppImage=x86_64/arm64,
// pacman FILENAME=x64/aarch64, nsis→.exe, appx/msix=x64/arm64. A drift here would publish files the website
// links can't find, so assert the exact names for every target the packager builds.

const VERSION: string = require("../../../package.json").version;

describe("wails artifactName — canonical, per-format arch tokens", () => {
  it("linux x64 uses amd64 for deb, x86_64 for rpm, x64 for tar.gz", () => {
    const t = TARGETS.linux_x64;
    expect(artifactName(t, "deb")).toBe(`container-desktop-linux-amd64-${VERSION}.deb`);
    expect(artifactName(t, "rpm")).toBe(`container-desktop-linux-x86_64-${VERSION}.rpm`);
    expect(artifactName(t, "tar.gz")).toBe(`container-desktop-linux-x64-${VERSION}.tar.gz`);
  });

  it("linux arm64 uses arm64 for deb, aarch64 for rpm, arm64 for tar.gz", () => {
    const t = TARGETS.linux_arm64;
    expect(artifactName(t, "deb")).toBe(`container-desktop-linux-arm64-${VERSION}.deb`);
    expect(artifactName(t, "rpm")).toBe(`container-desktop-linux-aarch64-${VERSION}.rpm`);
    expect(artifactName(t, "tar.gz")).toBe(`container-desktop-linux-arm64-${VERSION}.tar.gz`);
  });

  it("linux AppImage uses x86_64/arm64, pacman filename uses x64/aarch64", () => {
    expect(artifactName(TARGETS.linux_x64, "AppImage")).toBe(`container-desktop-linux-x86_64-${VERSION}.AppImage`);
    expect(artifactName(TARGETS.linux_arm64, "AppImage")).toBe(`container-desktop-linux-arm64-${VERSION}.AppImage`);
    expect(artifactName(TARGETS.linux_x64, "pacman")).toBe(`container-desktop-linux-x64-${VERSION}.pacman`);
    expect(artifactName(TARGETS.linux_arm64, "pacman")).toBe(`container-desktop-linux-aarch64-${VERSION}.pacman`);
  });

  it("windows zip/nsis/appx/msix drop the platform prefix; nsis ships as a .exe", () => {
    expect(artifactName(TARGETS.win_x64, "zip")).toBe(`container-desktop-x64-${VERSION}.zip`);
    expect(artifactName(TARGETS.win_arm64, "zip")).toBe(`container-desktop-arm64-${VERSION}.zip`);
    // The NSIS installer's file extension is .exe (not .nsis) — matches the private Windows installer asset.
    expect(artifactName(TARGETS.win_x64, "nsis")).toBe(`container-desktop-x64-${VERSION}.exe`);
    expect(artifactName(TARGETS.win_arm64, "nsis")).toBe(`container-desktop-arm64-${VERSION}.exe`);
    // Microsoft Store packages (private CI artifacts; the Store re-signs) — same names the Tauri path emits.
    expect(artifactName(TARGETS.win_x64, "appx")).toBe(`container-desktop-x64-${VERSION}.appx`);
    expect(artifactName(TARGETS.win_x64, "msix")).toBe(`container-desktop-x64-${VERSION}.msix`);
    expect(artifactName(TARGETS.win_arm64, "msix")).toBe(`container-desktop-arm64-${VERSION}.msix`);
  });

  it("macOS uses the mac- prefix", () => {
    expect(artifactName(TARGETS.mac_arm64, "tar.gz")).toBe(`container-desktop-mac-arm64-${VERSION}.tar.gz`);
    expect(artifactName(TARGETS.mac_arm64, "dmg")).toBe(`container-desktop-mac-arm64-${VERSION}.dmg`);
  });

  it("every target only declares formats it has an arch token for", () => {
    for (const [key, target] of Object.entries(TARGETS)) {
      for (const format of target.formats) {
        expect(() => artifactName(target, format), `${key}/${format}`).not.toThrow();
      }
    }
  });
});

describe("macInfoPlist — .app bundle identity from shared metadata", () => {
  const plist = macInfoPlist();
  const VERSION: string = require("../../../package.json").version;

  it("is a well-formed plist with the app identity keys", () => {
    expect(plist).toMatch(/^<\?xml/);
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain("</plist>");
    expect(plist).toContain("<key>CFBundleName</key><string>Container Desktop</string>");
    expect(plist).toContain("<key>CFBundleExecutable</key><string>container-desktop</string>");
    expect(plist).toContain("<key>CFBundleIdentifier</key><string>com.iongion.container-desktop.wails</string>");
    expect(plist).toContain(`<key>CFBundleShortVersionString</key><string>${VERSION}</string>`);
    expect(plist).toContain("<key>CFBundlePackageType</key><string>APPL</string>");
    expect(plist).toContain("<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>");
  });

  it("references the icns by basename (CFBundleIconFile appends .icns)", () => {
    expect(plist).toContain("<key>CFBundleIconFile</key><string>appIcon</string>");
  });
});

describe("nsisScript — per-user Windows installer directives", () => {
  const script = nsisScript({
    exe: "/tmp/staged/container-desktop.exe",
    out: "/out/setup.exe",
    iconFile: "/i/icon.ico",
  });

  it("is a per-user install (no admin) writing the given OutFile", () => {
    expect(script).toContain("RequestExecutionLevel user");
    expect(script).toContain('OutFile "/out/setup.exe"');
    expect(script).toContain('InstallDir "$LOCALAPPDATA\\Programs\\container-desktop"');
  });

  it("installs the exe, an uninstaller, shortcuts, and the Add/Remove-Programs registry entry", () => {
    expect(script).toContain('File "/oname=container-desktop.exe" "/tmp/staged/container-desktop.exe"');
    expect(script).toContain('WriteUninstaller "$INSTDIR\\Uninstall.exe"');
    expect(script).toContain('CreateShortcut "$SMPROGRAMS\\Container Desktop.lnk"');
    expect(script).toContain("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\container-desktop");
    expect(script).toContain('Section "Uninstall"');
    expect(script).toContain("DeleteRegKey HKCU");
  });

  it("includes the Icon directive only when an .ico is supplied", () => {
    expect(script).toContain('Icon "/i/icon.ico"');
    expect(nsisScript({ exe: "/e.exe", out: "/o.exe" })).not.toContain("Icon ");
  });
});
