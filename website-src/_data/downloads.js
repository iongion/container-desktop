// Per-OS download matrix.
// Native format per OS, plus portable archives where the installer differs.
// Linux names intentionally mirror electron-builder output:
// .deb uses amd64/arm64, .rpm uses x86_64/aarch64, .tar.gz uses x64/arm64.
//
// downloadReleaseVersion tracks package.json (via site.version) so the download
// links always match the current release — tasks.py rebuilds the site on release,
// keeping package.json in lockstep with the published tag/assets. The Windows
// installer wrapper is a manual Microsoft Store artifact that may intentionally
// lag to avoid broken links, so it stays pinned by hand.
import { createRequire } from "node:module";
import site from "./site.js";

const require = createRequire(import.meta.url);
const { linuxArtifactName, macArtifactName, winArtifactName } = require("../../support/release-artifacts.cjs");
const downloadReleaseVersion = site.version;
const windowsInstallerReleaseVersion = "5.2.13";
const base = `https://github.com/iongion/container-desktop/releases/download/${downloadReleaseVersion}`;
const windowsInstallerBase = `https://github.com/iongion/container-desktop/releases/download/${windowsInstallerReleaseVersion}`;
const windowsInstallerWrapper = "container-desktop-installer.exe";

function releaseAsset(name) {
  return `${base}/${name}`;
}

function windowsInstallerAsset(name) {
  return `${windowsInstallerBase}/${name}`;
}

const linuxOptions = [
  {
    id: "linux-deb-x64",
    format: "deb",
    arch: "x64",
    file: releaseAsset(linuxArtifactName("amd64", downloadReleaseVersion, "deb")),
    label: "Debian / Ubuntu · x86_64 (.deb)",
    archLabel: "x86_64",
    badge: ".deb",
    buttonLabel: "Download .deb",
    column: "Intel",
    note: "Debian/Ubuntu <b>.deb</b> package",
  },
  {
    id: "linux-rpm-x64",
    format: "rpm",
    arch: "x64",
    file: releaseAsset(linuxArtifactName("x86_64", downloadReleaseVersion, "rpm")),
    label: "Fedora / RHEL · x86_64 (.rpm)",
    archLabel: "x86_64",
    badge: ".rpm",
    buttonLabel: "Download .rpm",
    column: "Intel",
    note: "Fedora/RHEL <b>.rpm</b> package",
  },
  {
    id: "linux-tar-x64",
    format: "tar",
    arch: "x64",
    file: releaseAsset(linuxArtifactName("x64", downloadReleaseVersion, "tar.gz")),
    label: "Portable tarball · x86_64 (.tar.gz)",
    archLabel: "x86_64",
    badge: ".tar.gz",
    buttonLabel: "Download .tar.gz",
    column: "Intel",
    note: "Portable <b>tarball</b> — unpack &amp; run",
  },
  {
    id: "linux-deb-arm64",
    format: "deb",
    arch: "arm64",
    file: releaseAsset(linuxArtifactName("arm64", downloadReleaseVersion, "deb")),
    label: "Debian / Ubuntu · arm64 (.deb)",
    archLabel: "arm64",
    badge: ".deb",
    buttonLabel: "Download .deb",
    column: "Arm",
    note: "Debian/Ubuntu <b>.deb</b> package",
  },
  {
    id: "linux-rpm-arm64",
    format: "rpm",
    arch: "arm64",
    file: releaseAsset(linuxArtifactName("aarch64", downloadReleaseVersion, "rpm")),
    label: "Fedora / RHEL · arm64 (.rpm)",
    archLabel: "arm64",
    badge: ".rpm",
    buttonLabel: "Download .rpm",
    column: "Arm",
    note: "Fedora/RHEL <b>.rpm</b> package",
  },
  {
    id: "linux-tar-arm64",
    format: "tar",
    arch: "arm64",
    file: releaseAsset(linuxArtifactName("arm64", downloadReleaseVersion, "tar.gz")),
    label: "Portable tarball · arm64 (.tar.gz)",
    archLabel: "arm64",
    badge: ".tar.gz",
    buttonLabel: "Download .tar.gz",
    column: "Arm",
    note: "Portable <b>tarball</b> — unpack &amp; run",
  },
];

const linuxRows = [
  {
    title: "Debian / Ubuntu",
    badge: ".deb",
    options: [linuxOptions[0], linuxOptions[3]],
  },
  {
    title: "Fedora / RHEL",
    badge: ".rpm",
    options: [linuxOptions[1], linuxOptions[4]],
  },
  {
    title: "Portable tarball",
    badge: ".tar.gz",
    options: [linuxOptions[2], linuxOptions[5]],
  },
];

const macPrimary = {
  file: releaseAsset(macArtifactName("arm64", downloadReleaseVersion, "dmg")),
  buttonLabel: "Download .dmg",
  note: "Standard <b>.dmg</b> disk image",
};

const macLinks = [
  {
    file: releaseAsset(macArtifactName("arm64", downloadReleaseVersion, "tar.gz")),
    label: "Portable .tar.gz",
  },
];

const windowsPrimary = {
  file: site.microsoftStore,
  buttonLabel: "Microsoft Store",
  note: "Install from the <b>Microsoft Store</b>",
};

const windowsLinks = [
  {
    // This is the Microsoft Store wrapper manually uploaded after packaging; it may lag the generated assets.
    file: windowsInstallerAsset(windowsInstallerWrapper),
    label: "Installer .exe",
  },
  {
    file: releaseAsset(winArtifactName("x64", downloadReleaseVersion, "zip")),
    label: "Portable .zip",
  },
];

export default {
  os: [
    {
      id: "Linux",
      slug: "linux",
      icon: "fa-linux",
      meta: "x86_64 · arm64",
      file: linuxOptions[0].file,
      buttonLabel: linuxOptions[0].buttonLabel,
      note: linuxOptions[0].note,
      menu: true,
      options: linuxOptions,
      rows: linuxRows,
    },
    {
      id: "macOS",
      slug: "macos",
      icon: "fa-apple",
      meta: "Apple silicon",
      file: macPrimary.file,
      buttonLabel: macPrimary.buttonLabel,
      note: macPrimary.note,
      links: macLinks,
    },
    {
      id: "Windows",
      slug: "windows",
      icon: "fa-windows",
      meta: "x64",
      file: windowsPrimary.file,
      buttonLabel: windowsPrimary.buttonLabel,
      note: windowsPrimary.note,
      links: windowsLinks,
    },
  ],
};
