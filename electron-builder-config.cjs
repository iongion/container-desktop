const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
// vendors
const dayjs = require("dayjs");
const dotenv = require("dotenv");
const semver = require("semver");
const xml2js = require("xml2js");
// pkg
const pkg = require("./package.json");
const { linuxArtifactName, macArtifactName, winArtifactName } = require("./support/release-artifacts.cjs");
const { electronBuilderTargets } = require("./support/build-matrix.cjs");
// module
const version = pkg.version;
const semverVersion = semver.parse(version);
// MAJOR.MIN.REV.BUILD for Windows Store compatibility
const buildNumber = Number(
  process.env.BUILD_NUMBER || semverVersion.build?.[0] || semverVersion.prerelease?.[0]?.[0] || 0,
);
const buildVersion = `${semverVersion.major}.${semverVersion.minor}.${semverVersion.patch}.${buildNumber}`;
const electronBuilderArchMacro = ["$", "{arch}"].join("");
const electronBuilderExtMacro = ["$", "{ext}"].join("");
const ENVIRONMENT = process.env.ENVIRONMENT || "development";
const PROJECT_HOME = path.resolve(__dirname);

// Package formats to emit come from support/build-matrix.cjs — the single source
// of truth shared with the website's download page, so the two never drift.
// Default: Linux tar.gz + deb + rpm + AppImage + pacman; macOS dmg + tar.gz;
// Windows appx + nsis (.exe) + zip. Set PACKAGE_FORMATS=tgz to force portable
// .tgz tarballs on macOS/Windows (Linux always emits its full set).
// flatpak is intentionally omitted until Flathub is set up properly — a .flatpak
// for a container manager needs sandbox / flatpak-spawn --host work to reach the
// host Podman/Docker, and Flathub builds from a manifest, not a prebuilt bundle.
const tgzOnly = process.env.PACKAGE_FORMATS === "tgz";

// template
dotenv.config({ path: path.join(PROJECT_HOME, ".env") });
dotenv.config({ path: path.join(PROJECT_HOME, ".env.local"), override: true });
// target env
dotenv.config({ path: path.join(PROJECT_HOME, `.env.${ENVIRONMENT}`), override: true });
dotenv.config({ path: path.join(PROJECT_HOME, `.env.${ENVIRONMENT}.local`), override: true });

// injected
const year = dayjs().format("YYYY");
const identityName = "IonutStoica.ContainerDesktop";
const applicationId = identityName;
const displayName = pkg.title;
const releaseName = `${displayName} ${version}`;
const author = (pkg.author || "").replace(/\s+/g, ".");
const publisher = process.env.PUBLISHER || `CN=${author}`;
const publisherDisplayName = process.env.PUBLISHER_DISPLAY_NAME || pkg.author;
const config = {
  appId: "container-desktop.iongion.github.io",
  productName: process.platform === "linux" ? pkg.name : displayName,
  buildNumber,
  buildVersion,
  artifactName: winArtifactName(electronBuilderArchMacro, version, electronBuilderExtMacro),
  copyright: `Copyright (c) ${year} ${pkg.author}`,
  releaseInfo: {
    releaseName,
    releaseDate: dayjs().format("MMM DD, YYYY"),
  },
  asar: true,
  files: [
    // Exclude all
    "!**/*",
    // What to copy
    "build",
    "LICENSE",
  ],
  electronLanguages: ["en-US"],
  // includeSubNodeModule: false,
  extraMetadata: {
    version: buildVersion,
    buildVersion,
    buildNumber,
    main: pkg.main,
  },
  extraFiles: os.type() === "Windows_NT" ? ["bin/*"] : [],
  directories: {
    app: ".",
    output: "release",
    buildResources: "src/resources",
  },
  publish: null,
  mac: {
    artifactName: macArtifactName(electronBuilderArchMacro, version, electronBuilderExtMacro),
    category: "public.app-category.developer-tools",
    icon: "icons/appIcon.icns",
    target: tgzOnly ? "tar.gz" : electronBuilderTargets("mac"),
    type: "development",
    entitlements: "entitlements.mac.plist",
    entitlementsInherit: "entitlements.mac.inherit.plist",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    extendInfo: {
      NSCameraUsageDescription: "~",
      NSMicrophoneUsageDescription: "~",
    },
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: displayName,
  },
  win: {
    target: tgzOnly ? ["tar.gz"] : electronBuilderTargets("win"),
    // certificateFile: "ContainerDesktop.pfx",
    // See https://stackoverflow.com/questions/61736021/icon-sizes-for-uwp-apps-universal-windows-platform-appx
    icon: "icons/icon.ico",
  },
  appxManifestCreated: async (appxPath) => {
    const manifest = await xml2js.parseStringPromise(fs.readFileSync(appxPath, "utf8").toString());
    manifest.Package.$["xmlns:uap"] = "http://schemas.microsoft.com/appx/manifest/uap/windows10";
    manifest.Package.$["xmlns:desktop"] = "http://schemas.microsoft.com/appx/manifest/desktop/windows10";
    manifest.Package.$["xmlns:desktop2"] = "http://schemas.microsoft.com/appx/manifest/desktop/windows10/2";
    manifest.Package.Capabilities = [
      [
        { Capability: { $: { Name: "internetClient" } } },
        { Capability: { $: { Name: "privateNetworkClientServer" } } },
        { "rescap:Capability": { $: { Name: "runFullTrust" } } },
      ],
    ];
    const builder = new xml2js.Builder();
    const manifestDocument = builder.buildObject(manifest);
    fs.writeFileSync(appxPath, manifestDocument);
  },
  appx: {
    identityName,
    publisher,
    publisherDisplayName: publisherDisplayName,
    applicationId,
    setBuildNumber: false, // Always false otherwise rejected by Windows Store
    displayName,
    minVersion: "10.0.18362.0",
    maxVersionTested: "10.0.18362.0",
  },
  linux: {
    artifactName: linuxArtifactName(electronBuilderArchMacro, version, electronBuilderExtMacro),
    executableName: "container-desktop",
    // Match the installed .desktop filename to Electron's app_id / WM_CLASS so
    // desktop environments associate running windows with the launcher entry
    // (icon, taskbar pinning, window grouping). Derives from desktopName in
    // package.json, falling back to executableName. Default becomes true in v27.
    syncDesktopName: true,
    maintainer: publisher,
    icon: "icons/appIcon-unified.png",
    target: electronBuilderTargets("linux"),
    category: "Development;System;Utility",
    desktop: {
      entry: displayName,
    },
    executableArgs: ["--no-sandbox"],
  },
};

module.exports = config;
