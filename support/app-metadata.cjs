// Single source of truth for app branding + packaging metadata, shared by ALL THREE desktop backends
// so nothing can drift:
//   • electron-builder-config.cjs         — require() directly (raw Node)
//   • support/cli/lib/wails-package.ts     — require() via createRequire (tsx)
//   • src-tauri/tauri.conf.json            — a DERIVED file, kept in sync by `yarn cli sync-manifests`,
//                                            which writes productName / identifier / window title from here
//
// Values that already live in package.json (name, title, description, author, version, license) are read
// from there — package.json stays the root source. This module adds the packaging-only constants that
// don't belong in package.json: the per-backend reverse-DNS identifiers (each STABLE — they key app
// identity, update channels and Store listings), the freedesktop + macOS categories, the shared icon
// source dir + per-target icon filenames, the .desktop entry text, and the Linux runtime dependencies.
//
// Mirrors the build-matrix.cjs / release-artifacts.cjs pattern: plain CommonJS, so both the
// electron-builder .cjs config and the tsx-run TypeScript tooling consume it unchanged.

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
const homepage = "https://container-desktop.com";

/** `Copyright (c) <year> <author>` — the caller passes the year (electron uses dayjs). */
function copyright(year) {
  return `Copyright (c) ${year} ${author}`;
}

// Reverse-DNS-ish identifiers differ per backend + store and MUST stay stable — changing one breaks
// update channels / Store identity. Defined ONCE here so every consumer reads the same literal.
const identifiers = {
  electronAppId: "container-desktop.iongion.github.io", // electron-builder appId
  windowsIdentity: "IonutStoica.ContainerDesktop", // appx identityName + applicationId
  tauri: "com.iongion.container-desktop.tauri", // tauri.conf.json identifier
  wails: "com.iongion.container-desktop.wails", // wails macOS bundle id (future)
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
  linux: "appIcon-unified.png", // electron linux + wails .desktop icon
  mac: "appIcon.icns",
  win: "icon.ico",
};

// Linux runtime deps for the GTK3 / webkit2gtk-4.1 Wails build — same libraries, distro-specific package
// names: Debian (.deb Depends) vs Fedora/RHEL (.rpm Requires).
const linuxRuntimeDepends = ["libgtk-3-0", "libwebkit2gtk-4.1-0", "libayatana-appindicator3-1"]; // .deb
const rpmRequires = ["gtk3", "webkit2gtk4.1", "libappindicator-gtk3"]; // .rpm

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
  linuxRuntimeDepends,
  rpmRequires,
};
