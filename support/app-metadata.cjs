// Single source of truth for app branding + packaging metadata, so nothing can drift:
//   • src-tauri/tauri.conf.json            — a DERIVED file, kept in sync by `yarn cli sync-manifests`,
//                                            which writes productName / identifier / window title from here
//
// Values that already live in package.json (name, title, description, author, version, license) are read
// from there — package.json stays the root source. This module adds the packaging-only constants that
// don't belong in package.json: the reverse-DNS identifiers (each STABLE — they key app identity, update
// channels and Store listings), the freedesktop + macOS categories, the shared icon source dir + per-target
// icon filenames, and the .desktop entry text.
//
// Mirrors the build-matrix.cjs / release-artifacts.cjs pattern: plain CommonJS, so both the
// the .cjs packaging helpers and the tsx-run TypeScript tooling consume it unchanged.

const pkg = require("../package.json"); // support/ sits one level under the repo root

const name = pkg.name; // container-desktop — binary, deb Package, WM class, desktopName
const product = pkg.title; // Container Desktop — display name / window title
const description = pkg.description; // Container Desktop — short description
const summary = "Manage container engines — Podman, Docker, Apple Container"; // .desktop Comment
const longDescription = "Cross-platform desktop app for managing container engines (Podman, Docker, Apple Container).";
const author = pkg.author; // Ionut Stoica
const maintainer = pkg.author; // deb Maintainer (Name; package.json carries no email)
const license = pkg.license; // MIT
const version = pkg.version; // convenience re-export; package.json stays the source (see sync-manifests)
const homepage = "https://iongion.github.io/container-desktop";

// `Copyright (c) <year> <author>` — the caller passes the year.
function copyright(year) {
  return `Copyright (c) ${year} ${author}`;
}

// Reverse-DNS-ish identifiers differ per store and MUST stay stable — changing one breaks update channels /
// Store identity. Defined ONCE here so every consumer reads the same literal.
const identifiers = {
  windowsIdentity: "IonutStoica.ContainerDesktop", // appx identityName + applicationId
  tauri: "com.iongion.container-desktop.tauri", // tauri.conf.json identifier
};

// freedesktop `Categories=` (trailing `;` per spec) + macOS LSApplicationCategoryType.
const categories = {
  freedesktop: "Development;System;Utility;",
  mac: "public.app-category.developer-tools",
};

// Icons all originate from ONE source dir; each packager references the file its format needs.
const icons = {
  dir: "src/resources/icons",
  png: "appIcon.png",
  linux: "appIcon-unified.png", // linux .desktop icon
  mac: "appIcon.icns",
  win: "icon.ico",
};

module.exports = {
  name,
  product,
  description,
  summary,
  longDescription,
  author,
  maintainer,
  license,
  version,
  homepage,
  copyright,
  identifiers,
  categories,
  icons,
};
