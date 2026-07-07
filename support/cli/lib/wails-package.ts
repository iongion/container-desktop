// Wails cross-build packager. Leverages Go's cross-compilation — a concrete win over the Tauri path, which needs
// SSH build-boxes because Rust cross-builds are painful: every target here builds from ONE host. Windows is
// purego (CGO_ENABLED=0), so win_x64/win_arm64 .exes cross-compile straight from Linux; linux_x64 is a native
// cgo GTK3 build. macOS + linux_arm64 need an SDK / arm64 cross-gcc (they error clearly and are skipped locally,
// left to per-OS CI). Artifacts land in release/ with the canonical names release-artifacts.cjs expects — the
// SAME names the website/release matrix uses, via per-format arch tokens (deb=amd64, rpm=x86_64, tar.gz/zip=x64).
//
// Formats — full Tauri parity: Linux tar.gz + deb + rpm + pacman (bsdtar, like tauri-native-bundles.cjs — no
// makepkg) + AppImage (appimagetool); macOS tar.gz + dmg; Windows zip + nsis (makensis, a Linux tool too, so it
// cross-builds) + appx/msix (reuses the tauri-win-store.cjs recipe; makeappx is Windows-SDK only → CD windows
// runners). tar/dpkg-deb/rpmbuild/bsdtar/makensis all run on any Linux host; appimagetool via $APPIMAGETOOL/PATH.
//
// Run: `tsx support/cli/lib/wails-package.ts <target> [format...]` (e.g. linux_x64, win_x64). Assumes the renderer
// is already staged (`yarn wails:renderer`) — go:embed needs src-wails/frontend/dist present.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for app branding + packaging metadata (shared with electron-builder-config.cjs and,
// via `yarn cli sync-manifests`, src-tauri/tauri.conf.json) + the canonical artifact-naming helpers (shared
// with the release/website matrix). Both are CommonJS → require them from this ESM file.
const requireCjs = createRequire(import.meta.url);
const appMeta = requireCjs("../../app-metadata.cjs");
const { linuxArtifactName, macArtifactName, winArtifactName } = requireCjs("../../release-artifacts.cjs");
// Reuse the proven Tauri out-of-band packaging recipes so Wails does not reinvent them: the pacman .PKGINFO
// generator (single-sourced Arch dep list + field layout) and the Microsoft Store manifest/identity/pack helpers
// (a Wails-built appx/msix carries the SAME identity as the Tauri-built one; the Store re-signs either).
const { pacmanInfo } = requireCjs("../../tauri-native-bundles.cjs");
const { STORE_ASSETS, createStoreManifest, createPackCommand, resolveStoreIdentity, findMakeAppx } =
  requireCjs("../../tauri-win-store.cjs");
const pkgJson = requireCjs("../../../package.json");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(moduleDir, "../../..");
const SRC_WAILS = path.join(ROOT, "src-wails");
const RELEASE = path.join(ROOT, "release");
const RESOURCES = path.join(ROOT, appMeta.icons.dir);
const VERSION: string = appMeta.version;
const APP: string = appMeta.name;
const PRODUCT: string = appMeta.product;
const MAINTAINER: string = appMeta.maintainer;

interface Target {
  goos: string;
  goarch: string;
  arch: "x64" | "arm64";
  platform: "linux" | "win" | "mac";
  tags: string;
  cgo: "0" | "1";
  formats: string[];
}

export const TARGETS: Record<string, Target> = {
  // Native cgo GTK3 build (Tauri's stack) — the stable Linux path with working window drag.
  linux_x64: {
    goos: "linux",
    goarch: "amd64",
    arch: "x64",
    platform: "linux",
    tags: "production,gtk3",
    cgo: "1",
    formats: ["tar.gz", "deb", "rpm", "AppImage", "pacman"],
  },
  // arm64 Linux — same native-format cgo GTK3 build; needs an aarch64 cross-gcc + arm64 gtk3 libs, so it
  // builds on the arm64 CI runner, not a bare x64 host. The packagers (tar/deb/rpm) are arch-agnostic.
  linux_arm64: {
    goos: "linux",
    goarch: "arm64",
    arch: "arm64",
    platform: "linux",
    tags: "production,gtk3",
    cgo: "1",
    formats: ["tar.gz", "deb", "rpm", "AppImage", "pacman"],
  },
  // Purego (no cgo) → cross-compiles from Linux with zero extra toolchain. THE Go-over-Rust cross-build win. zip
  // (portable) + nsis (installer .exe, via makensis which is a Linux tool too) both cross-build here; the Store
  // appx/msix need makeappx (Windows SDK), so they are passed explicitly on the CD windows runners, not defaulted.
  win_x64: {
    goos: "windows",
    goarch: "amd64",
    arch: "x64",
    platform: "win",
    tags: "production",
    cgo: "0",
    formats: ["zip", "nsis"],
  },
  win_arm64: {
    goos: "windows",
    goarch: "arm64",
    arch: "arm64",
    platform: "win",
    tags: "production",
    cgo: "0",
    formats: ["zip", "nsis"],
  },
  // macOS arm64 — cgo/Cocoa, so it builds on a macOS runner (like Tauri's mac job). Both formats ship a proper
  // `Container Desktop.app` bundle: tar.gz packs the bundle, dmg is a drag-to-install disk image (hdiutil). Both
  // the binary and the dmg need macOS, so this whole target runs on the macos runner.
  mac_arm64: {
    goos: "darwin",
    goarch: "arm64",
    arch: "arm64",
    platform: "mac",
    tags: "production",
    cgo: "1",
    formats: ["tar.gz", "dmg"],
  },
};

// Per-format arch tokens — MUST match support/build-matrix.cjs + support/tauri-native-bundles.cjs (verified
// against published release assets): deb=amd64, rpm=x86_64/aarch64, tar.gz + zip + nsis + appx + msix=x64/arm64,
// AppImage=x86_64/arm64, dmg=arm64, pacman FILENAME=x64/aarch64. Drives the canonical filename; the in-package
// arch field uses the rpm token where it differs (rpm BuildArch, pacman .PKGINFO arch = x86_64/aarch64).
const ARCH_TOKEN: Record<"x64" | "arm64", Record<string, string>> = {
  x64: {
    "tar.gz": "x64",
    zip: "x64",
    deb: "amd64",
    rpm: "x86_64",
    AppImage: "x86_64",
    dmg: "x64",
    pacman: "x64",
    nsis: "x64",
    appx: "x64",
    msix: "x64",
  },
  arm64: {
    "tar.gz": "arm64",
    zip: "arm64",
    deb: "arm64",
    rpm: "aarch64",
    AppImage: "arm64",
    dmg: "arm64",
    pacman: "aarch64",
    nsis: "arm64",
    appx: "arm64",
    msix: "arm64",
  },
};

function archToken(target: Target, format: string): string {
  const token = ARCH_TOKEN[target.arch]?.[format];
  if (!token) {
    throw new Error(`no arch token for ${target.arch}/${format}`);
  }
  return token;
}

// Canonical release filename — delegates to release-artifacts.cjs so wails artifacts match the website/release
// matrix exactly (naming is format-based, not backend-based). `format` doubles as the file extension, except the
// NSIS installer, which ships as a `.exe` (matching the Tauri nsis artifact + release-artifacts.cjs).
export function artifactName(target: Target, format: string): string {
  const token = archToken(target, format);
  const ext = format === "nsis" ? "exe" : format;
  if (target.platform === "win") {
    return winArtifactName(token, VERSION, ext);
  }
  if (target.platform === "mac") {
    return macArtifactName(token, VERSION, ext);
  }
  return linuxArtifactName(token, VERSION, ext);
}

function run(cmd: string, args: string[], env?: Record<string, string>): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
}

function buildBinary(target: Target): string {
  const exe = target.platform === "win" ? ".exe" : "";
  const out = path.join(SRC_WAILS, "bin", `${APP}-${target.goos}-${target.goarch}${exe}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`\n▸ cross-build ${target.goos}/${target.goarch} (cgo=${target.cgo}, -tags ${target.tags})`);
  run("go", ["-C", SRC_WAILS, "build", "-tags", target.tags, "-o", out, "."], {
    GOOS: target.goos,
    GOARCH: target.goarch,
    CGO_ENABLED: target.cgo,
    ENVIRONMENT: "production",
  });
  return out;
}

function desktopEntry(): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${PRODUCT}`,
    `Comment=${appMeta.summary}`,
    `Exec=/usr/bin/${APP} %U`,
    `Icon=${APP}`,
    "Terminal=false",
    `Categories=${appMeta.categories.freedesktop}`,
    `StartupWMClass=${APP}`,
    "",
  ].join("\n");
}

function packTarGz(target: Target, binary: string): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "cd-tgz-"));
  const root = path.join(staging, `${APP}-${VERSION}`);
  fs.mkdirSync(root, { recursive: true });
  if (target.platform === "mac") {
    // macOS: ship the .app bundle (a bare unix binary would not launch as a GUI app).
    macAppBundle(binary, root);
  } else {
    fs.copyFileSync(binary, path.join(root, APP));
    fs.chmodSync(path.join(root, APP), 0o755);
    fs.writeFileSync(path.join(root, `${APP}.desktop`), desktopEntry());
    copyIcon(path.join(root, `${APP}.png`));
  }
  const out = path.join(RELEASE, artifactName(target, "tar.gz"));
  run("tar", ["-czf", out, "-C", staging, `${APP}-${VERSION}`]);
  fs.rmSync(staging, { recursive: true, force: true });
  return out;
}

function packDeb(target: Target, binary: string): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "cd-deb-"));
  const mkdir = (p: string) => fs.mkdirSync(path.join(staging, p), { recursive: true });
  mkdir("DEBIAN");
  mkdir("usr/bin");
  mkdir("usr/share/applications");
  mkdir("usr/share/icons/hicolor/256x256/apps");
  fs.copyFileSync(binary, path.join(staging, "usr/bin", APP));
  fs.chmodSync(path.join(staging, "usr/bin", APP), 0o755);
  fs.writeFileSync(path.join(staging, "usr/share/applications", `${APP}.desktop`), desktopEntry());
  copyIcon(path.join(staging, "usr/share/icons/hicolor/256x256/apps", `${APP}.png`));
  fs.writeFileSync(
    path.join(staging, "DEBIAN", "control"),
    [
      `Package: ${APP}`,
      `Version: ${VERSION}`,
      "Section: utils",
      "Priority: optional",
      `Architecture: ${archToken(target, "deb")}`,
      `Maintainer: ${MAINTAINER}`,
      // GTK3 + webkit2gtk-4.1 runtime (the -tags gtk3 build) + the ayatana appindicator for the tray.
      `Depends: ${appMeta.linuxRuntimeDepends.join(", ")}`,
      `Description: ${PRODUCT}`,
      ` ${appMeta.longDescription}`,
      "",
    ].join("\n"),
  );
  const out = path.join(RELEASE, artifactName(target, "deb"));
  run("dpkg-deb", ["--root-owner-group", "--build", staging, out]);
  fs.rmSync(staging, { recursive: true, force: true });
  return out;
}

function packRpm(target: Target, binary: string): string {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "cd-rpm-"));
  const buildroot = path.join(top, "BUILDROOT");
  // Lay the install tree straight into BUILDROOT and package it with `-bb` — no %prep/%build/%install
  // stages (the binary is already built), so this works cross-arch: an aarch64 rpm packs on an x64 host.
  const place = (rel: string): string => {
    const dest = path.join(buildroot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    return dest;
  };
  const bin = place(`usr/bin/${APP}`);
  fs.copyFileSync(binary, bin);
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(place(`usr/share/applications/${APP}.desktop`), desktopEntry());
  copyIcon(place(`usr/share/icons/hicolor/256x256/apps/${APP}.png`));
  const rpmArch = archToken(target, "rpm"); // x86_64 / aarch64
  fs.mkdirSync(path.join(top, "SPECS"), { recursive: true });
  const specPath = path.join(top, "SPECS", `${APP}.spec`);
  fs.writeFileSync(
    specPath,
    [
      `Name: ${APP}`,
      `Version: ${VERSION}`,
      "Release: 1",
      `Summary: ${PRODUCT}`,
      "License: MIT",
      `BuildArch: ${rpmArch}`,
      // Fedora/RHEL runtime names for the GTK3 / webkit2gtk-4.1 build + appindicator tray.
      `Requires: ${appMeta.rpmRequires.join(", ")}`,
      "%description",
      appMeta.longDescription,
      "%files",
      `/usr/bin/${APP}`,
      `/usr/share/applications/${APP}.desktop`,
      `/usr/share/icons/hicolor/256x256/apps/${APP}.png`,
      "",
    ].join("\n"),
  );
  run("rpmbuild", [
    "-bb",
    "--define",
    `_topdir ${top}`,
    "--define",
    `_rpmdir ${top}/RPMS`,
    "--buildroot",
    buildroot,
    specPath,
  ]);
  const out = path.join(RELEASE, artifactName(target, "rpm"));
  fs.copyFileSync(path.join(top, "RPMS", rpmArch, `${APP}-${VERSION}-1.${rpmArch}.rpm`), out);
  fs.rmSync(top, { recursive: true, force: true });
  return out;
}

// macOS Info.plist for the .app bundle — branding/identity from the shared metadata module. Exported so its
// (error-prone) key/value set can be unit-tested without a mac.
export function macInfoPlist(): string {
  const iconFile = appMeta.icons.mac.replace(/\.icns$/, ""); // CFBundleIconFile appends .icns
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>CFBundleName</key><string>${PRODUCT}</string>`,
    `  <key>CFBundleDisplayName</key><string>${PRODUCT}</string>`,
    `  <key>CFBundleExecutable</key><string>${APP}</string>`,
    `  <key>CFBundleIdentifier</key><string>${appMeta.identifiers.wails}</string>`,
    `  <key>CFBundleIconFile</key><string>${iconFile}</string>`,
    `  <key>CFBundleVersion</key><string>${VERSION}</string>`,
    `  <key>CFBundleShortVersionString</key><string>${VERSION}</string>`,
    "  <key>CFBundlePackageType</key><string>APPL</string>",
    "  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>",
    `  <key>LSApplicationCategoryType</key><string>${appMeta.categories.mac}</string>`,
    "  <key>LSMinimumSystemVersion</key><string>10.13</string>",
    "  <key>NSHighResolutionCapable</key><true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

// Assemble `Container Desktop.app` (Info.plist + MacOS/<binary> + Resources/<icns>) under `intoDir`. Pure file
// ops (no mac-only tools), so it stages on any host; only the dmg's hdiutil step needs macOS.
function macAppBundle(binary: string, intoDir: string): string {
  const app = path.join(intoDir, `${PRODUCT}.app`);
  const contents = path.join(app, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
  const exe = path.join(contents, "MacOS", APP);
  fs.copyFileSync(binary, exe);
  fs.chmodSync(exe, 0o755);
  const icns = path.join(RESOURCES, appMeta.icons.mac);
  if (fs.existsSync(icns)) {
    fs.copyFileSync(icns, path.join(contents, "Resources", appMeta.icons.mac));
  }
  fs.writeFileSync(path.join(contents, "Info.plist"), macInfoPlist());
  return app;
}

function packDmg(target: Target, binary: string): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "cd-dmg-"));
  macAppBundle(binary, staging);
  // Drag-to-install layout: the .app beside an /Applications symlink.
  fs.symlinkSync("/Applications", path.join(staging, "Applications"));
  const out = path.join(RELEASE, artifactName(target, "dmg"));
  fs.rmSync(out, { force: true });
  // hdiutil is macOS-only; the darwin binary is built on the same macOS runner (cgo/Cocoa needs the SDK), so both
  // live on the macos job. UDZO = zlib-compressed read-only image (the standard distributable .dmg).
  run("hdiutil", ["create", "-volname", PRODUCT, "-srcfolder", staging, "-ov", "-format", "UDZO", out]);
  fs.rmSync(staging, { recursive: true, force: true });
  return out;
}

function packZip(target: Target, binary: string): string {
  const out = path.join(RELEASE, artifactName(target, "zip"));
  fs.rmSync(out, { force: true });
  const staged = path.join(path.dirname(binary), `${APP}.exe`);
  fs.copyFileSync(binary, staged);
  // `zip -j` flattens; store the exe under the canonical name.
  run("zip", ["-j", out, staged]);
  return out;
}

function copyIcon(dest: string): void {
  // Reuse a shipped brand mark as the app icon (single source; go:embed's `..` limit does not apply to packaging).
  const candidates = [path.join(RESOURCES, appMeta.icons.linux), path.join(RESOURCES, appMeta.icons.png)];
  const src = candidates.find((c) => fs.existsSync(c));
  if (src) {
    fs.copyFileSync(src, dest);
  }
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(entryPath) : fs.statSync(entryPath).size;
  }
  return total;
}

// pacman package (.pkg.tar.zst) — built with bsdtar exactly like support/tauri-native-bundles.cjs (Tauri v2 has
// no pacman bundler, so the repo already solved this WITHOUT makepkg). The .PKGINFO comes from the shared
// pacmanInfo generator; the in-package arch is x86_64/aarch64 (the rpm token) while the filename uses x64/aarch64.
function packPacman(target: Target, binary: string): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "cd-pacman-"));
  const root = path.join(stage, "pkg");
  const place = (rel: string): string => {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    return dest;
  };
  const bin = place(`usr/bin/${APP}`);
  fs.copyFileSync(binary, bin);
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(place(`usr/share/applications/${APP}.desktop`), desktopEntry());
  copyIcon(place(`usr/share/icons/hicolor/512x512/apps/${APP}.png`));
  const license = path.join(ROOT, "LICENSE");
  if (fs.existsSync(license)) {
    fs.copyFileSync(license, place(`usr/share/licenses/${APP}/LICENSE`));
  }
  fs.writeFileSync(
    place(".PKGINFO"),
    pacmanInfo({
      pkg: { name: APP, version: VERSION, description: appMeta.summary, title: PRODUCT, author: appMeta.author },
      packageArch: archToken(target, "rpm"), // x86_64 / aarch64
      installedSize: dirSize(root),
    }),
  );
  // .MTREE describes the package contents; generate it to a scratch path (so it is not self-referential), then
  // drop it into the root. Exact bsdtar flags from tauri-native-bundles.cjs.
  const mtree = path.join(stage, ".MTREE");
  run("bsdtar", [
    "--format=mtree",
    "--options=!all,use-set,type,uid,gid,mode,time,size,sha256,link",
    "-cf",
    mtree,
    "-C",
    root,
    ".",
  ]);
  fs.copyFileSync(mtree, place(".MTREE"));
  const out = path.join(RELEASE, artifactName(target, "pacman"));
  fs.rmSync(out, { force: true });
  run("bsdtar", ["--zstd", "-cf", out, "-C", root, "."]);
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}

// AppImage — net-new (Tauri gets it from its own bundler; no repo recipe to reuse). Assemble a minimal .AppDir
// (binary + top-level .desktop + icon + AppRun launcher) and let appimagetool build the image. appimagetool comes
// from $APPIMAGETOOL or PATH; ARCH selects the target arch; APPIMAGE_EXTRACT_AND_RUN avoids needing FUSE in CI.
function packAppImage(target: Target, binary: string): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "cd-appimage-"));
  const appDir = path.join(stage, `${PRODUCT}.AppDir`);
  fs.mkdirSync(path.join(appDir, "usr", "bin"), { recursive: true });
  const innerBin = path.join(appDir, "usr", "bin", APP);
  fs.copyFileSync(binary, innerBin);
  fs.chmodSync(innerBin, 0o755);
  fs.writeFileSync(path.join(appDir, `${APP}.desktop`), desktopEntry());
  copyIcon(path.join(appDir, `${APP}.png`));
  const appRun = path.join(appDir, "AppRun");
  fs.writeFileSync(appRun, `#!/bin/sh\nHERE="$(dirname "$(readlink -f "$0")")"\nexec "$HERE/usr/bin/${APP}" "$@"\n`);
  fs.chmodSync(appRun, 0o755);
  const out = path.join(RELEASE, artifactName(target, "AppImage"));
  fs.rmSync(out, { force: true });
  run(process.env.APPIMAGETOOL || "appimagetool", [appDir, out], {
    ARCH: archToken(target, "AppImage"),
    APPIMAGE_EXTRACT_AND_RUN: "1",
  });
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}

// NSIS installer script — a per-user install (no admin), Start-Menu + Desktop shortcuts, an uninstaller, and the
// standard Add/Remove-Programs registry entry. Exported so the (error-prone) directive set is unit-testable
// without makensis. `iconFile` is optional (omitted if the .ico is missing).
export function nsisScript({ exe, out, iconFile }: { exe: string; out: string; iconFile?: string }): string {
  const key = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP}`;
  return [
    "Unicode true",
    `Name "${PRODUCT}"`,
    `OutFile "${out}"`,
    `InstallDir "$LOCALAPPDATA\\Programs\\${APP}"`,
    "RequestExecutionLevel user",
    iconFile ? `Icon "${iconFile}"` : "",
    iconFile ? `UninstallIcon "${iconFile}"` : "",
    "",
    'Section "Install"',
    '  SetOutPath "$INSTDIR"',
    `  File "/oname=${APP}.exe" "${exe}"`,
    '  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
    `  CreateShortcut "$SMPROGRAMS\\${PRODUCT}.lnk" "$INSTDIR\\${APP}.exe"`,
    `  CreateShortcut "$DESKTOP\\${PRODUCT}.lnk" "$INSTDIR\\${APP}.exe"`,
    `  WriteRegStr HKCU "${key}" "DisplayName" "${PRODUCT}"`,
    `  WriteRegStr HKCU "${key}" "DisplayVersion" "${VERSION}"`,
    `  WriteRegStr HKCU "${key}" "Publisher" "${appMeta.author}"`,
    `  WriteRegStr HKCU "${key}" "DisplayIcon" "$INSTDIR\\${APP}.exe"`,
    `  WriteRegStr HKCU "${key}" "UninstallString" "$INSTDIR\\Uninstall.exe"`,
    "SectionEnd",
    "",
    'Section "Uninstall"',
    `  Delete "$INSTDIR\\${APP}.exe"`,
    '  Delete "$INSTDIR\\Uninstall.exe"',
    `  Delete "$SMPROGRAMS\\${PRODUCT}.lnk"`,
    `  Delete "$DESKTOP\\${PRODUCT}.lnk"`,
    '  RMDir "$INSTDIR"',
    `  DeleteRegKey HKCU "${key}"`,
    "SectionEnd",
    "",
  ].join("\n");
}

// NSIS installer .exe — makensis is a Linux tool too, so this cross-builds from any host (the installer stub is
// x86 and runs on x64/arm64 Windows alike; it bundles the target-arch app exe).
function packNsis(target: Target, binary: string): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "cd-nsis-"));
  const exe = path.join(stage, `${APP}.exe`);
  fs.copyFileSync(binary, exe);
  const out = path.join(RELEASE, artifactName(target, "nsis"));
  fs.rmSync(out, { force: true });
  const icoPath = path.join(RESOURCES, appMeta.icons.win);
  const script = path.join(stage, "installer.nsi");
  fs.writeFileSync(script, nsisScript({ exe, out, iconFile: fs.existsSync(icoPath) ? icoPath : undefined }));
  run("makensis", ["-V2", script]);
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}

// Microsoft Store package (appx/msix) — reuses the Tauri Store recipe (createStoreManifest / createPackCommand /
// resolveStoreIdentity) so the identity, manifest, and assets are IDENTICAL to the Tauri-built package (the Store
// re-signs either). makeappx is Windows-SDK only, so this runs on the CD windows runners, not the Linux host.
function packAppxMsix(target: Target, binary: string, format: "appx" | "msix"): string {
  const identity = resolveStoreIdentity({ pkg: pkgJson, arch: target.arch });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `cd-${format}-`));
  const assets = path.join(stage, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(stage, "AppxManifest.xml"), createStoreManifest({ pkg: pkgJson, arch: target.arch }));
  fs.copyFileSync(binary, path.join(stage, identity.exeName)); // staged as container-desktop.exe (the manifest exe)
  for (const name of STORE_ASSETS as string[]) {
    fs.copyFileSync(path.join(ROOT, "src", "resources", "appx", name), path.join(assets, name));
  }
  const out = path.join(RELEASE, artifactName(target, format));
  fs.rmSync(out, { force: true });
  const pack = createPackCommand({ stageDir: stage, outputPath: out });
  run(findMakeAppx(), pack.args); // makeappx pack /d <stage> /p <out> /o
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}

function packOne(target: Target, format: string, binary: string): string {
  switch (format) {
    case "tar.gz":
      return packTarGz(target, binary);
    case "deb":
      return packDeb(target, binary);
    case "rpm":
      return packRpm(target, binary);
    case "pacman":
      return packPacman(target, binary);
    case "AppImage":
      return packAppImage(target, binary);
    case "zip":
      return packZip(target, binary);
    case "nsis":
      return packNsis(target, binary);
    case "appx":
      return packAppxMsix(target, binary, "appx");
    case "msix":
      return packAppxMsix(target, binary, "msix");
    case "dmg":
      return packDmg(target, binary);
    default:
      throw new Error(`unsupported wails package format: ${format}`);
  }
}

export function packageWails(targetKey: string, formats?: string[]): string[] {
  const target = TARGETS[targetKey];
  if (!target) {
    throw new Error(`unknown wails target "${targetKey}" (known: ${Object.keys(TARGETS).join(", ")})`);
  }
  if (!fs.existsSync(path.join(SRC_WAILS, "frontend", "dist", "index.html"))) {
    throw new Error("renderer not staged — run `yarn wails:renderer` first (go:embed needs frontend/dist)");
  }
  fs.mkdirSync(RELEASE, { recursive: true });
  const binary = buildBinary(target);
  const produced: string[] = [];
  for (const format of formats?.length ? formats : target.formats) {
    const artifact = packOne(target, format, binary);
    const bytes = fs.statSync(artifact).size;
    console.log(`  ✓ ${path.basename(artifact)} (${(bytes / 1_048_576).toFixed(1)} MB)`);
    produced.push(artifact);
  }
  return produced;
}

// CLI entry (tsx support/cli/lib/wails-package.ts <target> [formats...]).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [, , targetKey, ...formats] = process.argv;
  if (!targetKey) {
    console.error(`usage: wails-package <target> [format...]\ntargets: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  packageWails(targetKey, formats);
}
