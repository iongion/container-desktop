#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { linuxArtifactName, macArtifactName, winArtifactName, writeChecksum } = require("./release-artifacts.cjs");
const { stripBundledGraphicsLibs } = require("./appimage-libs.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RUST_TARGETS = {
  linux: {
    x64: "x86_64-unknown-linux-gnu",
    arm64: "aarch64-unknown-linux-gnu",
  },
  mac: {
    arm64: "aarch64-apple-darwin",
  },
  win: {
    x64: "x86_64-pc-windows-msvc",
    arm64: "aarch64-pc-windows-msvc",
  },
};
const LINUX_ARCH = {
  x64: {
    deb: "amd64",
    rpm: "x86_64",
    appImageSource: "amd64",
    appImageOutput: "x86_64",
    appImageArch: "x86_64",
    pacmanOutput: "x64",
    pacmanPackage: "x86_64",
  },
  arm64: {
    deb: "arm64",
    rpm: "aarch64",
    appImageSource: "aarch64",
    appImageOutput: "arm64",
    appImageArch: "aarch64",
    pacmanOutput: "aarch64",
    pacmanPackage: "aarch64",
  },
};

function readPackageJson(projectRoot = PROJECT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
}

function bundleRoot({ projectRoot, target }) {
  return path.join(projectRoot, "src-tauri", "target", target, "release", "bundle");
}

function releaseTargetDir({ projectRoot, target }) {
  return path.join(projectRoot, "src-tauri", "target", target, "release");
}

function nativeCopyPlan({ projectRoot, releaseDir, pkg, platform, arch, target, format }) {
  const root = bundleRoot({ projectRoot, target });
  if (platform === "linux") {
    const tokens = LINUX_ARCH[arch];
    if (!tokens) {
      throw new Error(`Unsupported Linux arch for Tauri native bundle: ${arch}`);
    }
    if (format === "deb") {
      return {
        kind: "copy",
        platform,
        arch,
        format,
        sourcePath: path.join(root, "deb", `${pkg.title}_${pkg.version}_${tokens.deb}.deb`),
        outputPath: path.join(releaseDir, linuxArtifactName(tokens.deb, pkg.version, "deb")),
      };
    }
    if (format === "rpm") {
      return {
        kind: "copy",
        platform,
        arch,
        format,
        sourcePath: path.join(root, "rpm", `${pkg.title}-${pkg.version}-1.${tokens.rpm}.rpm`),
        outputPath: path.join(releaseDir, linuxArtifactName(tokens.rpm, pkg.version, "rpm")),
      };
    }
    if (format === "AppImage") {
      return {
        kind: "appimage",
        platform,
        arch,
        format,
        archLabel: tokens.appImageArch,
        sourcePath: path.join(root, "appimage", `${pkg.title}_${pkg.version}_${tokens.appImageSource}.AppImage`),
        outputPath: path.join(releaseDir, linuxArtifactName(tokens.appImageOutput, pkg.version, "AppImage")),
        stageDir: path.join(releaseDir, "tauri-native", `linux-${arch}`, "appimage"),
      };
    }
  }
  if (platform === "mac" && format === "dmg") {
    return {
      kind: "copy",
      platform,
      arch,
      format,
      sourcePath: path.join(root, "dmg", `${pkg.title}_${pkg.version}_aarch64.dmg`),
      outputPath: path.join(releaseDir, macArtifactName("arm64", pkg.version, "dmg")),
    };
  }
  if (platform === "win" && format === "nsis") {
    return {
      kind: "copy",
      platform,
      arch,
      format,
      sourcePath: path.join(root, "nsis", `${pkg.title}_${pkg.version}_${arch}-setup.exe`),
      outputPath: path.join(releaseDir, winArtifactName(arch, pkg.version, "exe")),
    };
  }
  throw new Error(`Unsupported Tauri native bundle ${platform}/${arch}/${format}`);
}

function desktopEntry(pkg) {
  const executableName = pkg.desktopName || pkg.name;
  return `[Desktop Entry]
Name=${pkg.title || pkg.name}
Comment=${pkg.description || pkg.title || pkg.name}
Exec=${executableName}
Icon=${executableName}
Terminal=false
Type=Application
Categories=Development;System;Utility;
`;
}

function pacmanInfo({ pkg, packageArch, installedSize }) {
  return `pkgname = ${pkg.name}
pkgbase = ${pkg.name}
pkgver = ${pkg.version}-1
pkgdesc = ${pkg.description || pkg.title || pkg.name}
url = ${pkg.repository || "https://github.com/iongion/container-desktop"}
builddate = ${Math.floor(Date.now() / 1000)}
packager = ${pkg.author || "Container Desktop"}
size = ${installedSize}
arch = ${packageArch}
license = MIT
depend = gtk3
depend = webkit2gtk
depend = libappindicator-gtk3
`;
}

function createPacmanPlan({ projectRoot, releaseDir, pkg, arch, target }) {
  const tokens = LINUX_ARCH[arch];
  if (!tokens) {
    throw new Error(`Unsupported Linux arch for Tauri pacman bundle: ${arch}`);
  }
  const stageDir = path.join(releaseDir, "tauri-native", `linux-${arch}`, "pacman");
  const packageRoot = path.join(stageDir, "pkg");
  const executableName = pkg.desktopName || pkg.name;
  const outputPath = path.join(releaseDir, linuxArtifactName(tokens.pacmanOutput, pkg.version, "pacman"));
  const files = [
    {
      source: path.join(releaseTargetDir({ projectRoot, target }), executableName),
      destination: path.join(packageRoot, "usr", "bin", executableName),
    },
    {
      source: path.join(projectRoot, "src-tauri", "icons", "icon.png"),
      destination: path.join(
        packageRoot,
        "usr",
        "share",
        "icons",
        "hicolor",
        "512x512",
        "apps",
        `${executableName}.png`,
      ),
    },
    {
      source: path.join(projectRoot, "LICENSE"),
      destination: path.join(packageRoot, "usr", "share", "licenses", pkg.name, "LICENSE"),
    },
  ];
  return {
    kind: "pacman",
    platform: "linux",
    arch,
    format: "pacman",
    packageArch: tokens.pacmanPackage,
    stageDir,
    packageRoot,
    outputPath,
    files,
    desktopEntryPath: path.join(packageRoot, "usr", "share", "applications", `${executableName}.desktop`),
    metadataPath: path.join(packageRoot, ".PKGINFO"),
    mtreePath: path.join(packageRoot, ".MTREE"),
    mtreeScratchPath: path.join(stageDir, ".MTREE"),
    archiveCommand: {
      command: "bsdtar",
      args: ["--zstd", "-cf", outputPath, "-C", packageRoot, "."],
    },
  };
}

function defaultFormats(platform) {
  if (platform === "linux") return ["deb", "rpm", "AppImage", "pacman"];
  if (platform === "mac") return ["dmg"];
  if (platform === "win") return ["nsis"];
  throw new Error(`Unsupported Tauri native bundle platform: ${platform}`);
}

function createNativeBundlePlans(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const releaseDir = options.releaseDir || path.join(projectRoot, "release");
  const pkg = options.pkg || readPackageJson(projectRoot);
  const platform = options.platform;
  const arch = options.arch || (platform === "mac" ? "arm64" : "x64");
  const target = options.target || RUST_TARGETS[platform]?.[arch];
  if (!target) {
    throw new Error(`No Rust target configured for Tauri native bundle ${platform}/${arch}`);
  }
  const formats = options.formats || defaultFormats(platform);
  return formats.map((format) =>
    format === "pacman"
      ? createPacmanPlan({ projectRoot, releaseDir, pkg, arch, target })
      : nativeCopyPlan({ projectRoot, releaseDir, pkg, platform, arch, target, format }),
  );
}

function resolveExistingSource(sourcePath) {
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }
  const dir = path.dirname(sourcePath);
  if (!fs.existsSync(dir)) {
    return sourcePath;
  }
  const expectedExt = path.extname(sourcePath);
  const expectedBase = path.basename(sourcePath).replaceAll("_", "").replaceAll("-", "").toLowerCase();
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => path.extname(name) === expectedExt)
    .sort((left, right) => {
      const leftScore = expectedBase.includes(left.replaceAll("_", "").replaceAll("-", "").toLowerCase()) ? 0 : 1;
      const rightScore = expectedBase.includes(right.replaceAll("_", "").replaceAll("-", "").toLowerCase()) ? 0 : 1;
      return leftScore - rightScore || left.localeCompare(right);
    });
  return candidates[0] ? path.join(dir, candidates[0]) : sourcePath;
}

function copyNativeBundle(plan) {
  const sourcePath = resolveExistingSource(plan.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Tauri native bundle input: ${plan.sourcePath}`);
  }
  fs.mkdirSync(path.dirname(plan.outputPath), { recursive: true });
  if (path.resolve(sourcePath) !== path.resolve(plan.outputPath)) {
    fs.rmSync(plan.outputPath, { force: true });
  }
  fs.copyFileSync(sourcePath, plan.outputPath);
  writeChecksum(plan.outputPath);
}

function runProcess(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
  return result;
}

// appimagetool is provisioned onto PATH by support/provision-deps.sh (pinned + sha256-verified).
// A CONTAINER_DESKTOP_APPIMAGETOOL override lets local/offline builds point at their own copy.
function resolveAppImageTool() {
  const override = process.env.CONTAINER_DESKTOP_APPIMAGETOOL;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`CONTAINER_DESKTOP_APPIMAGETOOL points at a missing file: ${override}`);
    }
    return override;
  }
  const probe = childProcess.spawnSync("appimagetool", ["--version"], {
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
    stdio: "ignore",
  });
  if (probe.status === 0) {
    return "appimagetool";
  }
  throw new Error(
    "appimagetool not found on PATH. Install it with `bash support/provision-deps.sh` or set CONTAINER_DESKTOP_APPIMAGETOOL.",
  );
}

// Tauri/linuxdeploy AppImages bundle the host's libEGL/libgbm/libwayland-* copies; on newer/rolling
// distros those clash with the running Mesa/Wayland stack and abort at startup with
// "Could not create default EGL display: EGL_BAD_PARAMETER". Extract the freshly built AppImage,
// delete those host-provided libraries, and repack it so the app falls back to the host's copies.
function repackAppImageWithoutBundledLibs(plan) {
  const sourcePath = resolveExistingSource(plan.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Tauri native bundle input: ${plan.sourcePath}`);
  }
  fs.rmSync(plan.stageDir, { recursive: true, force: true });
  fs.mkdirSync(plan.stageDir, { recursive: true });
  fs.chmodSync(sourcePath, 0o755);
  // --appimage-extract unpacks without FUSE and yields <stageDir>/squashfs-root.
  runProcess(sourcePath, ["--appimage-extract"], { cwd: plan.stageDir });
  const appDir = path.join(plan.stageDir, "squashfs-root");
  const removed = stripBundledGraphicsLibs(appDir);
  console.log(
    `AppImage: removed ${removed.length} host-provided graphics lib(s)${removed.length ? ` -> ${removed.join(", ")}` : ""}`,
  );
  const appimagetool = resolveAppImageTool();
  fs.mkdirSync(path.dirname(plan.outputPath), { recursive: true });
  fs.rmSync(plan.outputPath, { force: true });
  runProcess(appimagetool, ["--no-appstream", appDir, plan.outputPath], {
    env: { ...process.env, ARCH: plan.archLabel, APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
  fs.chmodSync(plan.outputPath, 0o755);
  writeChecksum(plan.outputPath);
}

function directorySize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(entryPath);
    } else if (entry.isFile()) {
      total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function stagePacmanBundle(plan, pkg) {
  fs.rmSync(plan.stageDir, { recursive: true, force: true });
  for (const file of plan.files) {
    if (!fs.existsSync(file.source)) {
      throw new Error(`Missing Tauri pacman input: ${file.source}`);
    }
    fs.mkdirSync(path.dirname(file.destination), { recursive: true });
    fs.copyFileSync(file.source, file.destination);
  }
  fs.mkdirSync(path.dirname(plan.desktopEntryPath), { recursive: true });
  fs.writeFileSync(plan.desktopEntryPath, desktopEntry(pkg), "utf8");
  fs.writeFileSync(
    plan.metadataPath,
    pacmanInfo({ pkg, packageArch: plan.packageArch, installedSize: directorySize(plan.packageRoot) }),
    "utf8",
  );
  const mtree = childProcess.spawnSync(
    "bsdtar",
    [
      "--format=mtree",
      "--options=!all,use-set,type,uid,gid,mode,time,size,sha256,link",
      "-cf",
      plan.mtreeScratchPath,
      "-C",
      plan.packageRoot,
      ".",
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (mtree.status !== 0) {
    throw new Error("bsdtar failed while generating pacman .MTREE");
  }
  fs.copyFileSync(plan.mtreeScratchPath, plan.mtreePath);
}

function runArchiveCommand(plan) {
  fs.rmSync(plan.outputPath, { force: true });
  const result = childProcess.spawnSync(plan.archiveCommand.command, plan.archiveCommand.args, {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${plan.archiveCommand.command} ${plan.archiveCommand.args.join(" ")} failed`);
  }
  writeChecksum(plan.outputPath);
}

function collectNativeBundles(plans, pkg) {
  for (const plan of plans) {
    if (plan.kind === "copy") {
      copyNativeBundle(plan);
    } else if (plan.kind === "appimage") {
      repackAppImageWithoutBundledLibs(plan);
    } else if (plan.kind === "pacman") {
      stagePacmanBundle(plan, pkg);
      runArchiveCommand(plan);
    }
  }
}

function parseArgs(argv) {
  const args = { command: argv[2] || "collect", dryRun: false };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--platform" || arg === "--arch" || arg === "--target" || arg === "--release-dir") {
      args[arg.slice(2).replace("-", "_")] = argv[++index];
    } else if (arg === "--formats") {
      args.formats = argv[++index]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const pkg = readPackageJson(PROJECT_ROOT);
  const plans = createNativeBundlePlans({
    pkg,
    platform: args.platform,
    arch: args.arch,
    target: args.target,
    releaseDir: args.release_dir ? path.resolve(args.release_dir) : undefined,
    formats: args.formats,
  });
  if (args.command !== "collect") {
    throw new Error(`Unknown command: ${args.command}`);
  }
  for (const plan of plans) {
    const source = plan.kind === "pacman" ? plan.packageRoot : plan.sourcePath;
    console.log(`${plan.format}: ${source} -> ${plan.outputPath}`);
  }
  if (!args.dryRun) {
    collectNativeBundles(plans, pkg);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  createNativeBundlePlans,
};
