// Single source of truth for what each platform actually builds and publishes.
//
// Both the packager and the website read this file, so they can never drift:
//   - electron-builder-config.cjs derives its per-OS `target` arrays from here.
//   - website-src/_data/downloads.js renders its download cards from here.
//   - src/__tests__/website-downloads.test.ts asserts the two stay identical.
//
// Add or drop a package format in ONE place (the `formats` list below) and the
// build, the website and the guard test all move together.
//
// `arch` maps our canonical arch (x64 / arm64) to the token electron-builder
// actually bakes into each filename. These differ PER FORMAT and are verified
// against real published release assets — e.g. .deb uses amd64, .rpm uses
// x86_64/aarch64, .tar.gz uses x64/arm64, .AppImage uses x86_64/arm64, .pacman
// uses x64/aarch64. Do not "simplify" them to a single token.
//
// `public: false` marks artifacts that ARE built but intentionally NOT offered
// as downloads (Windows .appx + the unsigned NSIS .exe are superseded by the
// signed Microsoft Store wrapper). Keep this in sync with the exclusion logic in
// release-artifacts.cjs (isWindowsBuilderInstallerAsset).
const { linuxArtifactName, macArtifactName, winArtifactName } = require("./release-artifacts.cjs");

const REPO = "iongion/container-desktop";

// The Microsoft Store wrapper is a manually uploaded, signed installer that
// intentionally lags the generated assets. Bump this by hand ONLY after the
// Microsoft Store accepts a new submission: it pins both the Windows installer
// download link AND the in-app Windows update check (the /VERSION-Windows_NT
// endpoint, read by Api.clients.ts), so Windows users are never told about a
// build they cannot install yet.
const WINDOWS_INSTALLER_VERSION = "5.3.16";
const WINDOWS_INSTALLER_WRAPPER = "container-desktop-installer.exe";

// Canonical arches and how they read in the UI.
const ARCH = {
  x64: { label: "x86_64", column: "Intel" },
  arm64: { label: "arm64", column: "Arm" },
};

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
        arch: { x64: "amd64", arm64: "arm64" },
        title: "Debian / Ubuntu",
        badge: ".deb",
        button: "Download .deb",
        note: "Debian/Ubuntu <b>.deb</b> package",
      },
      {
        target: "rpm",
        ext: "rpm",
        arch: { x64: "x86_64", arm64: "aarch64" },
        title: "Fedora / RHEL",
        badge: ".rpm",
        button: "Download .rpm",
        note: "Fedora/RHEL <b>.rpm</b> package",
      },
      {
        target: "tar.gz",
        ext: "tar.gz",
        arch: { x64: "x64", arm64: "arm64" },
        title: "Portable tarball",
        badge: ".tar.gz",
        button: "Download .tar.gz",
        note: "Portable <b>tarball</b> — unpack &amp; run",
      },
      {
        target: "AppImage",
        ext: "AppImage",
        arch: { x64: "x86_64", arm64: "arm64" },
        title: "AppImage",
        badge: ".AppImage",
        button: "Download .AppImage",
        note: "Portable <b>AppImage</b> — make executable &amp; run",
      },
      {
        target: "pacman",
        ext: "pacman",
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
        arch: { arm64: "arm64" },
        title: "Disk image",
        badge: ".dmg",
        button: "Download .dmg",
        note: "Standard <b>.dmg</b> disk image",
      },
      {
        target: "tar.gz",
        ext: "tar.gz",
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
    meta: "x64",
    naming: winArtifactName,
    arches: ["x64"],
    menu: false,
    // Primary download is the Microsoft Store (external), wired up in downloadModel.
    primary: { store: true },
    formats: [
      { target: "appx", ext: "appx", arch: { x64: "x64" }, public: false },
      { target: "nsis", ext: "exe", arch: { x64: "x64" }, public: false },
      {
        target: "zip",
        ext: "zip",
        arch: { x64: "x64" },
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

// The exact published filename electron-builder emits for this platform/format/arch.
function assetName(platformKey, format, arch, version) {
  return PLATFORMS[platformKey].naming(format.arch[arch], version, format.ext);
}

// electron-builder `target` array for a platform, straight from the formats list.
function electronBuilderTargets(platformKey) {
  return PLATFORMS[platformKey].formats.map((format) => format.target);
}

// Every public, downloadable asset filename for a version — the set the website
// must link and the release must contain.
function publicAssetNames(version) {
  const names = [];
  for (const platformKey of Object.keys(PLATFORMS)) {
    const platform = PLATFORMS[platformKey];
    for (const format of platform.formats) {
      if (!isPublic(format)) continue;
      for (const arch of platform.arches) {
        if (!format.arch[arch]) continue;
        names.push(assetName(platformKey, format, arch, version));
      }
    }
  }
  return names.sort();
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
  const winGeneratedLinks = win.formats.filter(isPublic).flatMap((format) =>
    win.arches
      .map((arch) => optionFor("win", format, arch, version))
      .filter(Boolean)
      .map((option) => ({ file: option.file, label: formatByTarget(win, option.format).link })),
  );
  const winLinks = [
    {
      file: `https://github.com/${REPO}/releases/download/${WINDOWS_INSTALLER_VERSION}/${WINDOWS_INSTALLER_WRAPPER}`,
      label: "Installer .exe",
    },
    ...winGeneratedLinks,
  ];

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
        links: winLinks,
      },
    ],
  };
}

module.exports = {
  ARCH,
  PLATFORMS,
  WINDOWS_INSTALLER_VERSION,
  assetName,
  downloadModel,
  electronBuilderTargets,
  publicAssetNames,
};
