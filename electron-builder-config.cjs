// vendors
const dayjs = require("dayjs");
// pkg
const pkg = require("./package.json");
// module
const artifactName = [pkg.name, "${arch}", pkg.version].join("-");

const config = {
  appId: "io.github.iongion.PodmanDesktopCompanion",
  productName: pkg.title,
  buildVersion: pkg.version,
  artifactName: artifactName + ".${ext}",
  copyright: "../LICENSE",
  releaseInfo: {
    releaseName: `${pkg.title} ${pkg.version}`,
    releaseDate: dayjs().format("MMM DD, YYYY")
  },
  files: ["build"],
  extraMetadata: {
    version: pkg.version,
    main: `build/main-${pkg.version}.mjs`
  },
  directories: {
    app: ".",
    output: "release",
    buildResources: "src/resources"
  },
  flatpak: {
    base: "org.electronjs.Electron2.BaseApp",
    baseVersion: "23.08",
    branch: "main",
    category: "Utils",
    runtime: "org.freedesktop.Platform",
    runtimeVersion: "23.08",
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
    shortcutName: pkg.title
  },
  win: {
    target: ["nsis"],
    icon: "icons/icon.png"
  },
  linux: {
    icon: "icons/appIcon.svg",
    target: ["AppImage", "flatpak", "deb", "rpm"],
    category: "Utility"
  }
};

module.exports = config;
