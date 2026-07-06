#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { linuxArtifactName, macArtifactName, winArtifactName, writeChecksum } = require("./release-artifacts.cjs");

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

function readPackageJson(projectRoot = PROJECT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
}

function artifactPath({ platform, arch, version, releaseDir }) {
  if (platform === "linux") {
    return path.join(releaseDir, linuxArtifactName(arch, version, "tar.gz"));
  }
  if (platform === "mac") {
    return path.join(releaseDir, macArtifactName(arch, version, "tar.gz"));
  }
  if (platform === "win") {
    return path.join(releaseDir, winArtifactName(arch, version, "zip"));
  }
  throw new Error(`Unsupported Tauri portable platform: ${platform}`);
}

function releaseTargetDir({ projectRoot, target }) {
  return path.join(projectRoot, "src-tauri", "target", target, "release");
}

function appExecutableName(pkg, platform) {
  const executableName = pkg.desktopName || pkg.name;
  return platform === "win" ? `${executableName}.exe` : executableName;
}

function appBundleName(pkg) {
  return `${pkg.title || pkg.name}.app`;
}

function stagedRoot({ releaseDir, platform, arch, pkg }) {
  if (platform === "mac") {
    return path.join(releaseDir, "tauri-portable", `${platform}-${arch}`);
  }
  return path.join(releaseDir, "tauri-portable", `${platform}-${arch}`, pkg.name);
}

function portableFiles({ projectRoot, platform, arch, target, pkg, releaseDir }) {
  const stageRoot = stagedRoot({ releaseDir, platform, arch, pkg });
  if (platform === "mac") {
    const appName = appBundleName(pkg);
    return [
      {
        source: path.join(releaseTargetDir({ projectRoot, target }), "bundle", "macos", appName),
        destination: path.join(stageRoot, appName),
      },
    ];
  }

  const exeName = appExecutableName(pkg, platform);
  return [
    {
      source: path.join(releaseTargetDir({ projectRoot, target }), exeName),
      destination: path.join(stageRoot, exeName),
    },
    {
      source: path.join(projectRoot, "LICENSE"),
      destination: path.join(stageRoot, "LICENSE"),
    },
  ];
}

function createArchiveCommand({ platform, stageDir, outputPath, hostPlatform = process.platform }) {
  if (platform === "win") {
    if (hostPlatform === "win32") {
      return {
        command: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outputPath}' -Force`,
        ],
      };
    }
    return {
      command: "zip",
      args: ["-r", outputPath, "."],
      cwd: stageDir,
    };
  }
  return {
    command: "tar",
    args: ["-czf", outputPath, "-C", stageDir, "."],
  };
}

function createPortablePackagePlan(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const releaseDir = options.releaseDir || path.join(projectRoot, "release");
  const pkg = options.pkg || readPackageJson(projectRoot);
  const platform = options.platform;
  const arch = options.arch || (platform === "mac" ? "arm64" : "x64");
  const target = options.target || RUST_TARGETS[platform]?.[arch];
  if (!target) {
    throw new Error(`No Rust target configured for Tauri portable ${platform}/${arch}`);
  }

  const outputPath = artifactPath({ platform, arch, version: pkg.version, releaseDir });
  const stageDir = stagedRoot({ releaseDir, platform, arch, pkg });
  const files = portableFiles({ projectRoot, platform, arch, target, pkg, releaseDir });

  return {
    projectRoot,
    releaseDir,
    platform,
    arch,
    target,
    stageDir,
    outputPath,
    files,
    archiveCommand: createArchiveCommand({
      platform,
      stageDir,
      outputPath,
      hostPlatform: options.hostPlatform,
    }),
  };
}

function stagePortablePackage(plan) {
  const cleanRoot = path.join(plan.releaseDir, "tauri-portable", `${plan.platform}-${plan.arch}`);
  fs.rmSync(cleanRoot, { recursive: true, force: true });
  for (const file of plan.files) {
    if (!fs.existsSync(file.source)) {
      throw new Error(`Missing Tauri portable input: ${file.source}`);
    }
    fs.mkdirSync(path.dirname(file.destination), { recursive: true });
    fs.cpSync(file.source, file.destination, { recursive: true });
  }
}

function runArchiveCommand(plan) {
  fs.rmSync(plan.outputPath, { force: true });
  const command = plan.archiveCommand;
  const result = childProcess.spawnSync(command.command, command.args, {
    cwd: command.cwd || plan.projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command.command} ${command.args.join(" ")} failed`);
  }
  writeChecksum(plan.outputPath);
}

function parseArgs(argv) {
  const args = { command: argv[2] || "pack", arch: undefined, dryRun: false };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--platform" || arg === "--arch" || arg === "--target" || arg === "--release-dir") {
      args[arg.slice(2).replace("-", "_")] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const plan = createPortablePackagePlan({
    platform: args.platform,
    arch: args.arch,
    target: args.target,
    releaseDir: args.release_dir ? path.resolve(args.release_dir) : undefined,
  });

  if (!["stage", "pack"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }
  if (!args.dryRun) {
    stagePortablePackage(plan);
  }
  if (args.command === "pack") {
    if (args.dryRun) {
      const cwd = plan.archiveCommand.cwd ? ` (cwd ${plan.archiveCommand.cwd})` : "";
      console.log(
        `${plan.archiveCommand.command} ${plan.archiveCommand.args.map((part) => JSON.stringify(part)).join(" ")}${cwd}`,
      );
    } else {
      runArchiveCommand(plan);
    }
  }
  console.log(`Tauri portable ${plan.platform}/${plan.arch}: ${plan.outputPath}`);
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
  createArchiveCommand,
  createPortablePackagePlan,
};
