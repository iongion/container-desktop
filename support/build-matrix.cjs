// Single source of truth for what each platform actually builds and publishes.
//
// The release pipelines and website read this file, so they can never drift:
//   - CDPipeline.Tauri.yml (default) resolves its matrix through `cdJobsForTarget`; CDPipeline.Electron.yml
//     through `electronCdJobsForTarget` (ELECTRON_CD_JOBS); CDPipeline.Wails.yml through `wailsCdJobsForTarget`.
//   - website-src/_data/downloads.js renders its download cards from here.
//   - src/__tests__/website-downloads.test.ts asserts the two stay identical.
//
// Add or drop a package format in ONE place (the `formats` list below) and the
// release matrix, the website and the guard tests all move together.
//
// `arch` maps our canonical arch (x64 / arm64) to the token each published
// filename must keep for release parity. These differ PER FORMAT and are verified
// against real published release assets — e.g. .deb uses amd64, .rpm uses
// x86_64/aarch64, .tar.gz uses x64/arm64, .AppImage uses x86_64/arm64, .pacman
// uses x64/aarch64. Do not "simplify" them to a single token.
//
// `public: false` marks artifacts that ARE built but intentionally NOT offered
// as downloads (Windows Store packages + the unsigned NSIS .exe are superseded
// by the signed Microsoft Store wrapper). Keep this in sync with the exclusion
// logic in release-artifacts.cjs (isWindowsBuilderInstallerAsset).
const { linuxArtifactName, macArtifactName, winArtifactName } = require("./release-artifacts.cjs");

const REPO = "iongion/container-desktop";

// The Microsoft Store wrapper is a manually uploaded, signed installer that
// intentionally lags the generated assets. Bump this by hand ONLY after the
// Microsoft Store accepts a new submission: it pins both the Windows installer
// download link AND the in-app Windows update check (the /VERSION-Windows_NT
// endpoint, read by Api.clients.ts), so Windows users are never told about a
// build they cannot install yet.
const WINDOWS_INSTALLER_VERSION = "6.0.0";
// The signed Microsoft Store Web Installer stub is a hand-uploaded, architecture-NEUTRAL bootstrapper:
// one file serves both arches — at launch it detects the host arch and installs the matching package from
// the Store — so x64 and arm64 link to the same download (there is no separate arm64 wrapper).
const WINDOWS_INSTALLER_WRAPPER = "container-desktop-installer.exe";

// Canonical arches and how they read in the UI.
const ARCH = {
  x64: { label: "x86_64", column: "Intel" },
  arm64: { label: "arm64", column: "Arm" },
};

const RUNTIME = {
  tauri: "tauri",
  // Go backend, at full Tauri parity. It ships via the ADDITIVE CDPipeline.Wails.yml (WAILS_CD_JOBS below) and is
  // intentionally kept OUT of PLATFORMS.formats — those drive the public website/release, and Tauri remains the
  // publish-default, so Wails must not appear there yet.
  wails: "wails",
};

const PACKAGE_SCRIPT_BY_PLATFORM_ARCH = {
  linux: {
    x64: "package:tauri:linux_x86",
    arm64: "package:tauri:linux_arm",
  },
  mac: {
    arm64: "package:tauri:mac_arm",
  },
  win: {
    x64: "package:tauri:win_x64",
    arm64: "package:tauri:win_arm",
  },
};

const CD_JOBS = [
  {
    target: "linux-x64",
    os: "ubuntu-latest",
    rustTarget: "x86_64-unknown-linux-gnu",
    packageScript: "package:tauri:linux_x86",
  },
  {
    target: "linux-arm64",
    os: "ubuntu-24.04-arm",
    rustTarget: "aarch64-unknown-linux-gnu",
    packageScript: "package:tauri:linux_arm",
  },
  {
    target: "macos-arm64",
    os: "macos-latest",
    rustTarget: "aarch64-apple-darwin",
    packageScript: "package:tauri:mac_arm",
  },
  {
    target: "windows-x64",
    os: "windows-latest",
    rustTarget: "x86_64-pc-windows-msvc",
    packageScript: "package:tauri:win_x64",
  },
  {
    target: "windows-arm",
    os: "windows-11-arm",
    rustTarget: "aarch64-pc-windows-msvc",
    packageScript: "package:tauri:win_arm",
  },
];

// Electron CI matrix — the source of truth for CDPipeline.Electron.yml. Same per-OS-native-runner model as the
// Tauri CD_JOBS (no Rust; electron-builder packages via the retained package:electron:* scripts). Electron's
// historical set across all of 5.x is 4 targets — no Windows-on-ARM (electron-builder ships no arm64 Windows
// target) and no Intel mac. Kept OUT of PLATFORMS: Tauri stays the public website/release default.
const ELECTRON_CD_JOBS = [
  { target: "linux-x64", os: "ubuntu-latest", packageScript: "package:electron:linux_x86" },
  { target: "linux-arm64", os: "ubuntu-24.04-arm", packageScript: "package:electron:linux_arm" },
  { target: "macos-arm64", os: "macos-latest", packageScript: "package:electron:mac_arm" },
  { target: "windows-x64", os: "windows-latest", packageScript: "package:electron:win_x64" },
];

function electronCdJobsForTarget(target) {
  if (!target || target === "all") return ELECTRON_CD_JOBS;
  if (["linux", "macos", "windows"].includes(target)) {
    return ELECTRON_CD_JOBS.filter((job) => job.target.startsWith(`${target}-`));
  }
  return ELECTRON_CD_JOBS.filter((job) => job.target === target);
}

// Wails CI matrix — the source of truth for CDPipeline.Wails.yml (consumed via a setup job → fromJSON).
// Additive and separate from CD_JOBS: Wails leans on Go cross-compilation, so ONE Linux runner cross-builds
// Linux (native gtk3) AND Windows x64+arm64 (purego, cgo=0) — the concrete Go-over-Rust win. linux-arm64
// (arm64 cgo gtk3) and macOS (Cocoa cgo) still need their own runners. `targets` are keys in wails-package.ts
// TARGETS; the workflow stages the renderer once per job then runs the packager per target.
const WAILS_CD_JOBS = [
  { id: "linux-and-windows", os: "ubuntu-24.04", targets: ["linux_x64", "win_x64", "win_arm64"] },
  { id: "linux-arm64", os: "ubuntu-24.04-arm", targets: ["linux_arm64"] },
  { id: "macos-arm64", os: "macos-14", targets: ["mac_arm64"] },
  // Microsoft Store packages (appx/msix) are the ONLY formats that can't cross-build from Linux — makeappx ships
  // only in the Windows SDK — so they build on native Windows runners (mirroring the Tauri win-store step). The
  // portable zip + the NSIS installer still cross-build on the ubuntu job above; these add ONLY the Store
  // artifacts (a `formats` override). PRIVATE (release-artifacts.cjs isWindowsBuilderInstallerAsset) — the
  // Microsoft Store re-signs them, and a Wails-built package carries the SAME identity as the Tauri-built one.
  { id: "windows-store-x64", os: "windows-latest", targets: ["win_x64"], formats: ["appx", "msix"] },
  { id: "windows-store-arm64", os: "windows-11-arm", targets: ["win_arm64"], formats: ["appx", "msix"] },
];

function wailsCdJobsForTarget(target) {
  if (!target || target === "all") return WAILS_CD_JOBS;
  return WAILS_CD_JOBS.filter((job) => job.id === target);
}

const PLATFORMS = {
  linux: {
    name: "Linux",
    slug: "linux",
    icon: "fa-linux",
    meta: "x86_64 · arm64",
    naming: linuxArtifactName,
    arches: ["x64", "arm64"],
    menu: true,
    primary: { format: "deb", arch: "x64" },
    formats: [
      {
        target: "deb",
        ext: "deb",
        runtime: RUNTIME.tauri,
        arch: { x64: "amd64", arm64: "arm64" },
        title: "Debian / Ubuntu",
        badge: ".deb",
        button: "Download .deb",
        note: "Debian/Ubuntu <b>.deb</b> package",
      },
      {
        target: "rpm",
        ext: "rpm",
        runtime: RUNTIME.tauri,
        arch: { x64: "x86_64", arm64: "aarch64" },
        title: "Fedora / RHEL",
        badge: ".rpm",
        button: "Download .rpm",
        note: "Fedora/RHEL <b>.rpm</b> package",
      },
      {
        target: "tar.gz",
        ext: "tar.gz",
        runtime: RUNTIME.tauri,
        arch: { x64: "x64", arm64: "arm64" },
        title: "Portable tarball",
        badge: ".tar.gz",
        button: "Download .tar.gz",
        note: "Portable <b>tarball</b> — unpack &amp; run",
      },
      {
        target: "AppImage",
        ext: "AppImage",
        runtime: RUNTIME.tauri,
        arch: { x64: "x86_64", arm64: "arm64" },
        title: "AppImage",
        badge: ".AppImage",
        button: "Download .AppImage",
        note: "Portable <b>AppImage</b> — make executable &amp; run",
      },
      {
        target: "pacman",
        ext: "pacman",
        runtime: RUNTIME.tauri,
        arch: { x64: "x64", arm64: "aarch64" },
        title: "Arch Linux",
        badge: ".pacman",
        button: "Download .pacman",
        note: "Arch Linux <b>pacman</b> package",
      },
    ],
  },
  mac: {
    name: "macOS",
    slug: "macos",
    icon: "fa-apple",
    meta: "Apple silicon",
    naming: macArtifactName,
    arches: ["arm64"],
    menu: false,
    primary: { format: "dmg", arch: "arm64" },
    formats: [
      {
        target: "dmg",
        ext: "dmg",
        runtime: RUNTIME.tauri,
        arch: { arm64: "arm64" },
        title: "Disk image",
        badge: ".dmg",
        button: "Download .dmg",
        note: "Standard <b>.dmg</b> disk image",
      },
      {
        target: "tar.gz",
        ext: "tar.gz",
        runtime: RUNTIME.tauri,
        arch: { arm64: "arm64" },
        title: "Portable tarball",
        badge: ".tar.gz",
        button: "Download .tar.gz",
        note: "Portable <b>tarball</b>",
        link: "Portable .tar.gz",
      },
    ],
  },
  win: {
    name: "Windows",
    slug: "windows",
    icon: "fa-windows",
    meta: "x64 · arm64",
    naming: winArtifactName,
    arches: ["x64", "arm64"],
    menu: true,
    // Primary download is the Microsoft Store (external), wired up in downloadModel.
    primary: { store: true },
    formats: [
      { target: "appx", ext: "appx", runtime: RUNTIME.tauri, arch: { x64: "x64", arm64: "arm64" }, public: false },
      {
        target: "msix",
        ext: "msix",
        runtime: RUNTIME.tauri,
        arch: { x64: "x64", arm64: "arm64" },
        public: false,
        electron: false,
      },
      { target: "nsis", ext: "exe", runtime: RUNTIME.tauri, arch: { x64: "x64", arm64: "arm64" }, public: false },
      {
        target: "zip",
        ext: "zip",
        runtime: RUNTIME.tauri,
        arch: { x64: "x64", arm64: "arm64" },
        title: "Portable zip",
        badge: ".zip",
        button: "Download .zip",
        note: "Portable <b>.zip</b> archive",
        link: "Portable .zip",
      },
    ],
  },
};

function formatByTarget(platform, target) {
  return platform.formats.find((format) => format.target === target);
}

function isPublic(format) {
  return format.public !== false;
}

function downloadBase(version) {
  return `https://github.com/${REPO}/releases/download/${version}`;
}

// The exact published filename for this platform/format/arch.
function assetName(platformKey, format, arch, version) {
  return PLATFORMS[platformKey].naming(format.arch[arch], version, format.ext);
}

// Legacy electron-builder `target` array for a platform. Release automation uses
// Tauri package scripts from `releaseArtifactEntries`; keep this only for manual
// Electron fallback commands.
function electronBuilderTargets(platformKey) {
  return PLATFORMS[platformKey].formats.filter((format) => format.electron !== false).map((format) => format.target);
}

function packageScriptFor(platformKey, format, arch) {
  if (platformKey === "win" && format.target === "appx") {
    return arch === "arm64" ? "package:tauri:win_store:appx:arm64" : "package:tauri:win_store:appx";
  }
  if (platformKey === "win" && format.target === "msix") {
    return arch === "arm64" ? "package:tauri:win_store:msix:arm64" : "package:tauri:win_store:msix";
  }
  if (platformKey === "win" && format.target === "nsis") {
    return arch === "arm64" ? "package:tauri:win_nsis:arm64" : "package:tauri:win_nsis";
  }
  if (platformKey === "win" && format.target === "zip") {
    return arch === "arm64" ? "package:tauri:win_zip:arm64" : "package:tauri:win_zip";
  }
  return PACKAGE_SCRIPT_BY_PLATFORM_ARCH[platformKey]?.[arch];
}

function releaseArtifactEntries(version) {
  const entries = [];
  for (const platformKey of Object.keys(PLATFORMS)) {
    const platform = PLATFORMS[platformKey];
    for (const format of platform.formats) {
      for (const arch of platform.arches) {
        if (!format.arch[arch]) continue;
        entries.push({
          platform: platformKey,
          arch,
          format: format.target,
          runtime: format.runtime || RUNTIME.tauri,
          public: isPublic(format),
          fileName: assetName(platformKey, format, arch, version),
          packageScript: packageScriptFor(platformKey, format, arch),
        });
      }
    }
  }
  return entries;
}

function allAssetNames(version) {
  return releaseArtifactEntries(version)
    .map((entry) => entry.fileName)
    .sort();
}

// Every public, downloadable asset filename for a version — the set the website
// must link and the release must contain.
function publicAssetNames(version) {
  return releaseArtifactEntries(version)
    .filter((entry) => entry.public)
    .map((entry) => entry.fileName)
    .sort();
}

function cdJobsForTarget(target) {
  if (target === "all") return CD_JOBS;
  if (target === "linux") return CD_JOBS.filter((job) => job.target === "linux-x64" || job.target === "linux-arm64");
  if (target === "macos") return CD_JOBS.filter((job) => job.target === "macos-arm64");
  if (target === "windows")
    return CD_JOBS.filter((job) => job.target === "windows-x64" || job.target === "windows-arm");
  return CD_JOBS.filter((job) => job.target === target);
}

function optionFor(platformKey, format, arch, version) {
  if (!format.arch[arch]) return null;
  return {
    id: `${platformKey}-${format.target}-${arch}`,
    format: format.target,
    arch,
    file: `${downloadBase(version)}/${assetName(platformKey, format, arch, version)}`,
    label: `${format.title} · ${ARCH[arch].label} (${format.badge})`,
    archLabel: ARCH[arch].label,
    badge: format.badge,
    buttonLabel: format.button,
    column: ARCH[arch].column,
    note: format.note,
  };
}

// The view-model consumed by website-src/index.njk: one entry per OS card.
function downloadModel(version, { microsoftStore } = {}) {
  const linux = PLATFORMS.linux;
  const linuxOptions = [];
  for (const arch of linux.arches) {
    for (const format of linux.formats) {
      const option = isPublic(format) && optionFor("linux", format, arch, version);
      if (option) linuxOptions.push(option);
    }
  }
  const linuxRows = linux.formats.filter(isPublic).map((format) => ({
    title: format.title,
    badge: format.badge,
    options: linux.arches.map((arch) => optionFor("linux", format, arch, version)).filter(Boolean),
  }));
  const linuxPrimary = optionFor("linux", formatByTarget(linux, linux.primary.format), linux.primary.arch, version);

  const mac = PLATFORMS.mac;
  const macPrimary = optionFor("mac", formatByTarget(mac, mac.primary.format), mac.primary.arch, version);
  const macLinks = mac.formats
    .filter((format) => isPublic(format) && format.target !== mac.primary.format)
    .flatMap((format) =>
      mac.arches
        .map((arch) => optionFor("mac", format, arch, version))
        .filter(Boolean)
        .map((option) => ({ file: option.file, label: formatByTarget(mac, option.format).link })),
    );

  const win = PLATFORMS.win;
  // Windows uses the same per-arch package menu as Linux. The signed Store wrapper .exe is a hand-uploaded
  // artifact (pinned version, one file per arch), so it is built by hand here rather than via optionFor,
  // which only knows the auto-published release assets. The public .zip rows come straight from optionFor.
  const winInstallerRow = {
    title: "Installer",
    badge: ".exe",
    options: win.arches.map((arch) => ({
      id: `win-installer-${arch}`,
      format: "installer",
      arch,
      file: `https://github.com/${REPO}/releases/download/${WINDOWS_INSTALLER_VERSION}/${WINDOWS_INSTALLER_WRAPPER}`,
      label: `Installer · ${ARCH[arch].label} (.exe)`,
      archLabel: ARCH[arch].label,
      badge: ".exe",
      buttonLabel: "Download .exe",
      column: ARCH[arch].column,
      note: "Microsoft Store <b>installer</b>",
    })),
  };
  const winZipRows = win.formats.filter(isPublic).map((format) => ({
    title: format.title,
    badge: format.badge,
    options: win.arches.map((arch) => optionFor("win", format, arch, version)).filter(Boolean),
  }));
  const winRows = [winInstallerRow, ...winZipRows];
  const winOptions = winRows.flatMap((row) => row.options);

  return {
    os: [
      {
        id: linux.name,
        slug: linux.slug,
        icon: linux.icon,
        meta: linux.meta,
        file: linuxPrimary.file,
        buttonLabel: linuxPrimary.buttonLabel,
        note: linuxPrimary.note,
        menu: true,
        options: linuxOptions,
        rows: linuxRows,
      },
      {
        id: mac.name,
        slug: mac.slug,
        icon: mac.icon,
        meta: mac.meta,
        file: macPrimary.file,
        buttonLabel: macPrimary.buttonLabel,
        note: macPrimary.note,
        links: macLinks,
      },
      {
        id: win.name,
        slug: win.slug,
        icon: win.icon,
        meta: win.meta,
        file: microsoftStore,
        buttonLabel: "Microsoft Store",
        note: "Install from the <b>Microsoft Store</b>",
        // externalPrimary keeps the Store as the fixed primary button: index.njk marks no menu option
        // as primary, so os-detect.js never rewrites the button to a package download.
        menu: true,
        externalPrimary: true,
        options: winOptions,
        rows: winRows,
      },
    ],
  };
}

module.exports = {
  ARCH,
  CD_JOBS,
  ELECTRON_CD_JOBS,
  PLATFORMS,
  RUNTIME,
  WAILS_CD_JOBS,
  WINDOWS_INSTALLER_VERSION,
  allAssetNames,
  assetName,
  cdJobsForTarget,
  downloadModel,
  electronBuilderTargets,
  electronCdJobsForTarget,
  publicAssetNames,
  releaseArtifactEntries,
  wailsCdJobsForTarget,
};
