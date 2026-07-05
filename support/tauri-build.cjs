#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WINDOWS_MSVC_TARGETS = new Set(["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc", "i686-pc-windows-msvc"]);
const LINUX_ARM64_TARGET = "aarch64-unknown-linux-gnu";

function optionValue(args, option) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      return args[index + 1];
    }
    if (arg.startsWith(`${option}=`)) {
      return arg.slice(option.length + 1);
    }
  }
  return undefined;
}

function hasOption(args, option) {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function commandExists(name) {
  const result =
    process.platform === "win32"
      ? childProcess.spawnSync("where", [name], { stdio: "ignore" })
      : childProcess.spawnSync("sh", ["-lc", `command -v ${name}`], { stdio: "ignore" });
  return result.status === 0;
}

function tauriCommand(projectRoot = PROJECT_ROOT, hostPlatform = process.platform) {
  const localBin = path.join(projectRoot, "node_modules", ".bin", hostPlatform === "win32" ? "tauri.cmd" : "tauri");
  return fs.existsSync(localBin) ? localBin : "tauri";
}

function insertRunner(args, runner) {
  const nextArgs = [...args];
  const insertAt = nextArgs[0] && !nextArgs[0].startsWith("-") ? 1 : 0;
  nextArgs.splice(insertAt, 0, "--runner", runner);
  return nextArgs;
}

function createTauriBuildCommand(options = {}) {
  const args = [...(options.args || process.argv.slice(2))];
  const hostPlatform = options.hostPlatform || process.platform;
  const hostArch = options.hostArch || process.arch;
  const target = optionValue(args, "--target");
  const lookupCommand = options.commandExists || commandExists;
  const runner = options.runner || process.env.TAURI_WINDOWS_RUNNER || "cargo-xwin";
  let resolvedArgs = args;
  const env = options.env ? { ...options.env } : undefined;

  if (hostPlatform !== "win32" && WINDOWS_MSVC_TARGETS.has(target) && !hasOption(args, "--runner")) {
    if (runner.toLowerCase() !== "none") {
      if (!lookupCommand(runner)) {
        throw new Error(
          `Tauri Windows MSVC cross-builds from ${hostPlatform} require '${runner}'. ` +
            "Install cargo-xwin or set TAURI_WINDOWS_RUNNER=none to opt out.",
        );
      }
      resolvedArgs = insertRunner(args, runner);
    }
  }

  if (hostPlatform === "linux" && hostArch !== "arm64" && target === LINUX_ARM64_TARGET) {
    throw new Error(
      "Tauri Linux ARM64 builds from non-ARM64 Linux hosts must run in a Docker container, " +
        "CI ARM64 runner, or native ARM64 Linux host. Host apt multiarch sysroots are intentionally unsupported.",
    );
  }

  const command = options.command || tauriCommand(options.projectRoot || PROJECT_ROOT, hostPlatform);

  return {
    command,
    args: resolvedArgs,
    env,
    spawnOptions: hostPlatform === "win32" && command.toLowerCase().endsWith(".cmd") ? { shell: true } : undefined,
  };
}

function runTauriBuild(options = {}) {
  const build = createTauriBuildCommand(options);
  const result = childProcess.spawnSync(build.command, build.args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: { ...process.env, ...(build.env || {}) },
    stdio: "inherit",
    ...(build.spawnOptions || {}),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (require.main === module) {
  try {
    runTauriBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  createTauriBuildCommand,
};
