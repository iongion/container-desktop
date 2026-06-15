// Global site metadata. `version` is read from package.json at build time so the
// download URLs and cache-busters always match the current release — no regex
// post-processing needed.
import { createRequire } from "node:module";
import pkg from "../../package.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { WINDOWS_INSTALLER_VERSION } = require("../../support/build-matrix.cjs");

export default {
  name: "Container Desktop",
  tagline: "Podman Desktop Companion",
  description:
    "A familiar desktop interface for the free, open container managers — Podman and Docker. Local, remote over SSH, and WSL. Same UI on Windows, macOS and Linux.",
  url: "https://container-desktop.com",
  repo: "https://github.com/iongion/container-desktop",
  repoSlug: "iongion/container-desktop",
  podmanDesktop: "https://podman-desktop.io/",
  microsoftStore: "https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct",
  ogImage: "/img/001-Dashboard.png",
  author: "Ionut Stoica",
  version: pkg.version,
  // Windows lags: the signed Microsoft Store installer is uploaded by hand and
  // only bumped after the Store accepts a submission, so the in-app Windows
  // update check (/VERSION-Windows_NT) must report it, not pkg.version.
  windowsInstallerVersion: WINDOWS_INSTALLER_VERSION,
  year: new Date().getFullYear(),
};
