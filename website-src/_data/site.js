// Global site metadata. `version` is read from package.json at build time so the
// download URLs and cache-busters always match the current release — no regex
// post-processing needed.
import pkg from "../../package.json" with { type: "json" };

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
  year: new Date().getFullYear(),
  buildDate: new Date(),
};
