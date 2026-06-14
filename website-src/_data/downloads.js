// Per-OS download matrix, derived from the package.json version at build time.
// Native format per OS, plus portable archives where the installer differs:
// Linux .tar.gz, macOS .dmg + .tar.gz, Windows installer.exe + portable .zip.
import { createRequire } from "node:module";
import pkg from "../../package.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { linuxArtifactName, macArtifactName, winArtifactName } = require("../../support/release-artifacts.cjs");
const version = pkg.version;
const base = `https://github.com/iongion/container-desktop/releases/download/${version}`;
const windowsInstallerWrapper = "container-desktop-installer.exe";

export default {
  os: [
    {
      id: "Linux",
      icon: "fa-linux",
      meta: "x86_64 · arm64",
      file: `${base}/${linuxArtifactName("x64", version, "tar.gz")}`,
      ext: ".tar.gz",
      note: "Portable <b>tarball</b> — unpack &amp; run",
      options: [
        {
          file: `${base}/${linuxArtifactName("arm64", version, "tar.gz")}`,
          label: "ARM64 .tar.gz",
        },
      ],
    },
    {
      id: "macOS",
      icon: "fa-apple",
      meta: "Apple silicon",
      file: `${base}/${macArtifactName("arm64", version, "dmg")}`,
      ext: ".dmg",
      note: "Standard <b>.dmg</b> disk image",
      options: [
        {
          file: `${base}/${macArtifactName("arm64", version, "tar.gz")}`,
          label: "Portable .tar.gz",
        },
      ],
    },
    {
      id: "Windows",
      icon: "fa-windows",
      meta: "x64",
      // This is the Microsoft Store wrapper manually uploaded to the release after packaging.
      file: `${base}/${windowsInstallerWrapper}`,
      ext: ".exe",
      note: "Installer <b>.exe</b> · also on the <b>MS Store</b>",
      options: [
        {
          file: `${base}/${winArtifactName("x64", version, "zip")}`,
          label: "Portable .zip",
        },
      ],
    },
  ],
};
