// Per-OS download matrix, derived from the package.json version at build time.
// Reconciled formats: Linux .tar.gz, macOS .dmg, Windows installer.exe (+ Store).
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
    },
    {
      id: "Windows",
      icon: "fa-windows",
      meta: "x64",
      file: `${base}/container-desktop-installer.exe`,
      ext: ".exe",
      note: "Installer <b>.exe</b> · also on the <b>MS Store</b>",
    },
  ],
};
