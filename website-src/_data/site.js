// Global site metadata. `version` is read from package.json at build time so the
// download URLs and cache-busters always match the current release — no regex
// post-processing needed.
import { createRequire } from "node:module";
import pkg from "../../package.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { WINDOWS_INSTALLER_VERSION } = require("../../support/build-matrix.cjs");

// Engine color themes — single source of truth for the swatch picker and the per-engine media that
// swaps with it. `id` matches the CSS html[data-theme="…"] blocks in assets/css/site.css; `swatch`
// is the nav dot; `tagline` is the brand sub-line under the logo; `shots` is the screenshot folder
// under static/img/; `replay`/`poster` are the tutorial pseudo-video + its first frame. Capture
// writes per-engine media to /replays/<id>.json and /videos/<id>.png (see support/screenshots.mjs +
// support/demoReplay.mjs); until an engine has its own, point it at unified's. Add an engine = one
// entry here + one [data-theme] block in site.css; the nav loop, theme-switcher.js and
// demo-replay.js pick it up automatically.
const themes = [
  {
    id: "unified",
    label: "Unified",
    swatch: "#0a5f50",
    tagline: "Container desktop companion",
    shots: "unified",
    replay: "/replays/unified.json",
    poster: "/videos/unified.png",
  },
  {
    id: "podman",
    label: "Podman",
    swatch: "#a01986",
    tagline: "Podman desktop companion",
    shots: "podman",
    replay: "/replays/podman.json",
    poster: "/videos/podman.png",
  },
  {
    id: "docker",
    label: "Docker",
    swatch: "#163d8a",
    tagline: "Docker desktop companion",
    shots: "docker",
    replay: "/replays/docker.json",
    poster: "/videos/docker.png",
  },
];
const defaultTheme = "unified";
// Baked into the nav brand so the default theme's tagline shows before JS runs (no flash);
// theme-switcher.js swaps it on each swatch click.
const defaultTagline = themes.find((theme) => theme.id === defaultTheme)?.tagline;

export default {
  name: "Container Desktop",
  tagline: "Podman Desktop Companion",
  description:
    "A familiar desktop interface for the free, open container managers — Podman, Docker and Apple&trade; Container. Local, remote over SSH, and WSL. Same UI on Windows, macOS and Linux.",
  url: "https://container-desktop.com",
  repo: "https://github.com/iongion/container-desktop",
  repoSlug: "iongion/container-desktop",
  podmanDesktop: "https://podman-desktop.io/",
  microsoftStore: "https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct",
  ogImage: "/img/podman/001-Dashboard.png",
  author: "Ionut Stoica",
  themes,
  defaultTheme,
  defaultTagline,
  version: pkg.version,
  // Windows lags: the signed Microsoft Store installer is uploaded by hand and
  // only bumped after the Store accepts a submission, so the in-app Windows
  // update check (/VERSION-Windows_NT) must report it, not pkg.version.
  windowsInstallerVersion: WINDOWS_INSTALLER_VERSION,
  year: new Date().getFullYear(),
};
