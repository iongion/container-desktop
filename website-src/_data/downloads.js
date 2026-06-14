// Per-OS download matrix.
// Native format per OS, plus portable archives where the installer differs:
// Linux .tar.gz, macOS .dmg + .tar.gz, Windows Store + installer.exe + portable .zip.
//
// Keep downloadReleaseVersion on the latest GitHub release whose generated
// assets are actually published. The Windows installer wrapper is a manual
// Microsoft Store artifact and may intentionally lag to avoid broken links.
import { createRequire } from "node:module";
import site from "./site.js";

const require = createRequire(import.meta.url);
const { linuxArtifactName, macArtifactName, winArtifactName } = require("../../support/release-artifacts.cjs");
const downloadReleaseVersion = "5.2.16";
const windowsInstallerReleaseVersion = "5.2.13";
const base = `https://github.com/iongion/container-desktop/releases/download/${downloadReleaseVersion}`;
const windowsInstallerBase = `https://github.com/iongion/container-desktop/releases/download/${windowsInstallerReleaseVersion}`;
const windowsInstallerWrapper = "container-desktop-installer.exe";

export default {
  os: [
    {
      id: "Linux",
      icon: "fa-linux",
      meta: "x86_64 · arm64",
      file: `${base}/${linuxArtifactName("x64", downloadReleaseVersion, "tar.gz")}`,
      ext: ".tar.gz",
      note: "Portable <b>tarball</b> — unpack &amp; run",
      options: [
        {
          file: `${base}/${linuxArtifactName("arm64", downloadReleaseVersion, "tar.gz")}`,
          label: "ARM64 .tar.gz",
        },
      ],
    },
    {
      id: "macOS",
      icon: "fa-apple",
      meta: "Apple silicon",
      file: `${base}/${macArtifactName("arm64", downloadReleaseVersion, "dmg")}`,
      ext: ".dmg",
      note: "Standard <b>.dmg</b> disk image",
      options: [
        {
          file: `${base}/${macArtifactName("arm64", downloadReleaseVersion, "tar.gz")}`,
          label: "Portable .tar.gz",
        },
      ],
    },
    {
      id: "Windows",
      icon: "fa-windows",
      meta: "x64",
      file: site.microsoftStore,
      ext: "for Windows",
      note: "Install from the <b>Microsoft Store</b>",
      options: [
        {
          // This is the Microsoft Store wrapper manually uploaded after packaging; it may lag the generated assets.
          file: `${windowsInstallerBase}/${windowsInstallerWrapper}`,
          label: "Installer .exe",
        },
        {
          file: `${base}/${winArtifactName("x64", downloadReleaseVersion, "zip")}`,
          label: "Portable .zip",
        },
      ],
    },
  ],
};
