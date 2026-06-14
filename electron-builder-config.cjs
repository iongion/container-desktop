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

// Package formats to emit. Default builds native packages plus portable archives:
// Linux: tar.gz + deb + rpm, macOS: dmg + tar.gz, Windows: appx + nsis (.exe) + zip.
// Set PACKAGE_FORMATS=tgz to force portable .tgz tarballs on macOS/Windows.
// Linux always emits tar.gz + deb + rpm.
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
    target: tgzOnly ? "tar.gz" : ["dmg", "tar.gz"],
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
    target: tgzOnly ? ["tar.gz"] : ["appx", "nsis", "zip"],
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
    manifest.Package.Extensions = manifest.Package.Extensions || [];
    manifest.Package.Extensions.push({
      "desktop2:Extension": {
        $: {
          Category: "windows.firewallRules",
        },
        "desktop2:FirewallRules": {
          $: {
            Executable: "app\\bin\\container-desktop-ssh-relay.exe",
          },
          "desktop2:Rule": {
            $: {
              Direction: "in",
              Profile: "private",
              IPProtocol: "TCP",
              LocalPortMin: "22022",
              LocalPortMax: "24044",
            },
          },
        },
      },
    });
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
    maintainer: publisher,
    icon: "icons/appIcon.icns",
    target: ["tar.gz", "deb", "rpm"],
    category: "Development;System;Utility",
    desktop: {
      entry: displayName,
    },
    executableArgs: ["--no-sandbox"],
  },
};

module.exports = config;
