import { EventEmitter } from "eventemitter3";

import { createLogger } from "@/logger";
import { Platforms } from "@/web-app/Types.container-app";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const logger = await createLogger("executor");

export interface SpawnedProcess {
  pid: any;
  code: any;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command?: any;
}

export class Platform {
  static async getHomeDir() {
    return await (os.homedir() ?? process.env?.HOME ?? "");
  }

  static async getEnvironmentVariable(name: string) {
    return await (process.env || {})[name];
  }

  static async isFlatpak() {
    const FLATPAK_ID = await Platform.getEnvironmentVariable("FLATPAK_ID");
    if (FLATPAK_ID !== undefined) {
      return true;
    }
    try {
      const flag = await fs.existsSync("/.flatpak-info");
      return flag;
    } catch (error: any) {
      console.error("Unable to detect flatpak-info presence", error);
    }
    return false;
  }

  static async getUserDataPath() {
    const home = await Platform.getHomeDir();
    return await Path.join(home, ".config/podman-desktop-companion");
  }

  static async getOsType(): Promise<Platforms> {
    return (await os.type()) as Platforms;
  }
}

export class FS {
  static async readTextFile(location: string) {
    return await fs.readFileSync(location, { encoding: "utf-8" }).toString();
  }

  static async writeTextFile(location: string, contents: string) {
    return await fs.writeFileSync(location, contents, { encoding: "utf-8" });
  }

  static async isFilePresent(filePath: string) {
    let vfsFilePath: string = filePath;
    if (await Platform.isFlatpak()) {
      vfsFilePath = await Path.join("/var/run/host", filePath);
    }
    // console.debug("Checking file presence", { filePath, vfsFilePath });
    return await fs.existsSync(vfsFilePath);
  }

  static async mkdir(location: string, options?: any) {
    return await fs.mkdirSync(location, options);
  }

  static async rename(oldPath: string | URL, newPath: string | URL, options?: any) {
    return await fs.renameSync(oldPath, newPath);
  }
}

export class Path {
  static async join(...paths: string[]) {
    return await path.join(...paths);
  }
  static async basename(location: string, ext?: string) {
    return await path.basename(location, ext);
  }
  static async dirname(location: string) {
    return await path.dirname(location);
  }
  static async resolve(...paths: string[]) {
    return await path.resolve(...paths);
  }
}

// Commander
export function createWrapper(launcher, args, opts) {
  let commandLauncher = launcher;
  let commandArgs = args || [];
  if (opts?.wrapper) {
    commandArgs = [...(opts.wrapper.args || []), commandLauncher, ...commandArgs];
    commandLauncher = opts.wrapper.launcher;
  }
  return [commandLauncher, commandArgs];
}

export async function wrapSpawnAsync(launcher, launcherArgs, launcherOpts) {
  let spawnLauncher;
  let spawnArgs: any[] = [];
  let spawnOpts: any;
  if (await Platform.isFlatpak()) {
    const hostLauncher = "flatpak-spawn";
    const hostArgs = [
      "--host",
      // remove flatpak container VFS prefix when executing
      launcher.replace("/var/run/host", ""),
      ...launcherArgs
    ];
    spawnLauncher = hostLauncher;
    spawnArgs = hostArgs;
    spawnOpts = launcherOpts;
  } else {
    spawnLauncher = launcher;
    spawnArgs = launcherArgs;
    spawnOpts = launcherOpts;
  }
  const spawnLauncherOpts = { encoding: "utf-8", ...(spawnOpts || {}) };
  const command = [spawnLauncher, ...spawnArgs].join(" ");
  if (!spawnLauncher) {
    console.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path must be set");
  }
  if (typeof spawnLauncher !== "string") {
    console.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path has invalid type");
  }
  console.debug("[SC.A][>][spawn]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
  const child = spawn(spawnLauncher, spawnArgs, spawnLauncherOpts);
  // store for tracing and debugging
  (child as any).command = command;
  return child;
}

export async function exec_launcher_async(launcher, launcherArgs?: any[], opts?: any) {
  const spawnOpts = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env,
    detached: opts?.detached
  };
  const [spawnLauncher, spawnArgs] = createWrapper(launcher, launcherArgs, opts);
  return new Promise<SpawnedProcess>((resolve, reject) => {
    let resolved = false;
    return wrapSpawnAsync(spawnLauncher, spawnArgs, spawnOpts)
      .then((child) => {
        //
        const process: SpawnedProcess = {
          pid: undefined,
          code: undefined,
          success: false,
          stdout: "",
          stderr: "",
          command: "" // Decorated by child process
        };
        const command = (child as any).command;
        const processResolve = (from, data) => {
          if (resolved) {
            logger.error(command, "spawning already resolved", { from, data });
          } else {
            process.pid = child.pid as any;
            process.code = child.exitCode as any;
            process.stderr = process.stderr || "";
            process.success = child.exitCode === 0;
            process.command = command;
            resolved = true;
            logger.debug("[SC.A][<]", process);
            resolve(process);
          }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.on("exit", (code) => processResolve("exit", code));
        // child.on("close", (code) => processResolve("close", code));
        child.on("error", (error) => {
          logger.error(command, "spawning error", error.message);
          (process as any).error = error;
          processResolve("error", error);
        });
        child.stdout.on("data", (data) => {
          // logger.debug(command, "spawning stdout", data);
          process.stdout += `${data}`;
        });
        child.stderr.on("data", (data) => {
          logger.error(command, "spawning stderr", data);
          process.stderr += `${data}`;
        });
      })
      .catch(reject);
  });
}

export async function exec_launcher(launcher, launcherArgs, opts?: any) {
  return await exec_launcher_async(launcher, launcherArgs, opts);
}

export async function exec_service(opts) {
  let isManagedExit = false;
  let child;
  const process = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: ""
  };
  const { checkStatus, retry, programPath, programArgs } = opts;
  const em = new EventEmitter();
  // Check
  const running = await checkStatus();
  if (running) {
    logger.debug("Already running - reusing");
    process.success = true;
    setImmediate(() => {
      em.emit("ready", { process, child });
    });
  } else {
    // Handle
    const onProcessError = (child, error) => {
      logger.error("Child process error", error.code, error.message);
      em.emit("error", { type: "process.error", code: error.code });
    };
    const onProcessExit = (child, code) => {
      logger.debug("Child process exit", code);
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (child, code) => {
      logger.debug("Child process close", code);
      em.emit("close", { code });
    };
    const onProcessData = (child, from, data) => {
      if (from !== "stdout") {
        if (from === "stderr") {
          logger.warn("Child process data", child.pid, from, data);
        } else {
          logger.debug("Child process data", child.pid, from, data);
        }
      }
      em.emit("data", { from, data });
    };
    const waitForProcess = (child) => {
      let pending = false;
      let retries = retry?.count || 15;
      const wait = retry?.wait || 1000;
      const IID = setInterval(async () => {
        if (pending) {
          logger.debug("Waiting for result of last retry - skipping new retry");
          return;
        }
        logger.debug("Remaining", retries, "of", retry?.count);
        if (retries === 0) {
          clearInterval(IID);
          logger.error("Max retries reached");
          em.emit("error", { type: "domain.max-retries", code: undefined });
        } else {
          retries -= 1;
          pending = true;
          let running = false;
          try {
            running = await checkStatus();
          } catch (error: any) {
            logger.error("Checked status - failed", error.message);
          } finally {
            logger.debug("Checked status", { running });
          }
          pending = false;
          if (running) {
            clearInterval(IID);
            isManagedExit = true;
            process.success = true;
            em.emit("ready", { process, child });
          } else {
            logger.error("Move to next retry", retries);
          }
        }
      }, wait);
    };
    const onStart = async () => {
      const launcherOpts = {
        encoding: "utf-8",
        cwd: opts?.cwd,
        env: opts?.env
      };
      child = await wrapSpawnAsync(programPath, programArgs, launcherOpts);
      process.pid = child.pid;
      process.code = child.exitCode;
      child.on("exit", (code) => onProcessExit(child, code));
      child.on("close", (code) => onProcessClose(child, code));
      child.on("error", (error) => onProcessError(child, error));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => onProcessData(child, "stdout", data.toString()));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data) => onProcessData(child, "stderr", data.toString()));
      if (typeof child.pid === "undefined") {
        process.success = false;
        logger.error("Child process spawn failure", process);
      } else {
        process.success = !child.killed;
        logger.debug("Child process spawn success", process);
        waitForProcess(child);
      }
    };
    em.on("start", onStart);
    em.emit("start");
  }
  return em;
}

export class Command {
  static async Execute(launcher: string, args: string[], opts?: any) {
    return await exec_launcher_async(launcher, args, opts);
  }

  static async StartService(opts?: any) {
    return await exec_service(opts);
  }
}