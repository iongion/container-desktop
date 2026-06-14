// Per-OS download matrix, derived from the package.json version at build time.
// Native format per OS, plus a portable archive where the installer differs:
// Linux .tar.gz, macOS .dmg (+ portable .tar.gz), Windows installer.exe (+ portable .zip).
import pkg from "../../package.json" with { type: "json" };

const version = pkg.version;
const base = `https://github.com/iongion/container-desktop/releases/download/${version}`;

export default {
  os: [
    {
      id: "Linux",
      icon: "fa-linux",
      meta: "x86_64 · arm64",
      file: `${base}/container-desktop-x64-${version}.tar.gz`,
      ext: ".tar.gz",
      note: "Portable <b>tarball</b> — unpack &amp; run",
    },
    {
      id: "macOS",
      icon: "fa-apple",
      meta: "Apple silicon",
      file: `${base}/container-desktop-arm64-${version}.dmg`,
      ext: ".dmg",
      note: "Standard <b>.dmg</b> disk image",
      alt: { file: `${base}/container-desktop-arm64-${version}.tar.gz`, label: "or portable .tar.gz" },
    },
    {
      id: "Windows",
      icon: "fa-windows",
      meta: "x64",
      file: `${base}/container-desktop-installer.exe`,
      ext: ".exe",
      note: "Installer <b>.exe</b> · also on the <b>MS Store</b>",
      alt: { file: `${base}/container-desktop-x64-${version}.zip`, label: "or portable .zip" },
    },
  ],
};
