const path = require("path");
// vendors
const dayjs = require("dayjs");
const dotenv = require("dotenv");
// pkg
const pkg = require("./package.json");
// module
const artifactName = [pkg.name, "${arch}", pkg.version].join("-");
const ENVIRONMENT = process.env.ENVIRONMENT || "development";
const PROJECT_HOME = path.resolve(__dirname);

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
const releaseName = `${displayName} ${pkg.version}`;
const config = {
  appId: "container-desktop.iongion.github.io",
  productName: process.platform === "linux" ? pkg.name : displayName,
  buildVersion: pkg.version,
  artifactName: artifactName + ".${ext}",
  copyright: `Copyright (c) ${year} ${pkg.author}`,
  releaseInfo: {
    releaseName,
    releaseDate: dayjs().format("MMM DD, YYYY")
  },
  asar: true,
  files: [
    // Exclude all
    "!**/*",
    // What to copy
    "build",
    "LICENSE"
  ],
  electronLanguages: ["en-US"],
  // includeSubNodeModule: false,
  extraMetadata: {
    version: pkg.version,
    main: pkg.main
  },
  directories: {
    app: ".",
    output: "release",
    buildResources: "src/resources"
  },
  publish: null,
  flatpak: {
    base: "org.electronjs.Electron2.BaseApp",
    baseVersion: "24.08",
    branch: "main",
    category: "Development",
    runtime: "org.freedesktop.Platform",
    runtimeVersion: "24.08",
    sdk: "org.freedesktop.Sdk",
    finishArgs: [
      "--share=network",
      "--share=ipc",
      "--socket=x11",
      "--socket=wayland",
      "--socket=pulseaudio",
      "--socket=session-bus",
      "--device=dri",
      "--device=kvm",
      "--filesystem=host",
      "--filesystem=host-os",
      "--filesystem=host-etc",
      "--filesystem=home",
      "--filesystem=/tmp",
      "--filesystem=xdg-run/bash",
      "--filesystem=xdg-run/nc",
      "--filesystem=xdg-run/socat",
      "--filesystem=xdg-run/which",
      "--filesystem=xdg-run/where",
      "--filesystem=xdg-run/ssh",
      "--filesystem=xdg-run/podman",
      "--filesystem=xdg-run/docker",
      "--talk-name=org.freedesktop.Notifications"
    ]
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: "icons/appIcon.icns",
    target: "dmg",
    type: "development",
    entitlements: "entitlements.mac.plist",
    entitlementsInherit: "entitlements.mac.inherit.plist",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    extendInfo: {
      NSCameraUsageDescription: "~",
      NSMicrophoneUsageDescription: "~"
    }
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: displayName
  },
  win: {
    target: ["appx"],
    // certificateFile: "ContainerDesktop.pfx",
    // See https://stackoverflow.com/questions/61736021/icon-sizes-for-uwp-apps-universal-windows-platform-appx
    icon: "icons/icon.ico"
  },
  appx: {
    identityName,
    publisher: process.env.PUBLISHER || pkg.author,
    publisherDisplayName: process.env.PUBLISHER_DISPLAY_NAME || pkg.author,
    applicationId,
    displayName
  },
  linux: {
    icon: "icons/appIcon.svg",
    target: ["deb", "pacman", "rpm", "flatpak", "AppImage"],
    category: "Development;System;Utility",
    extraResources: ["support/templates"],
    desktop: {
      Name: displayName
    },
    executableArgs: ["--no-sandbox"]
  },
  deb: {
    afterInstall: "support/templates/after-install.sh",
    afterRemove: "support/templates/after-remove.sh"
  }
};

module.exports = config;
