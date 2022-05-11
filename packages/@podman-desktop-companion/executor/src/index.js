const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const events = require("events");
// vendors
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("executor");
const isFlatpak = !!process.env.FLATPAK_ID || fs.existsSync("/.flatpak-info");

function isFilePresent(filePath) {
  let vfsFilePath = filePath;
  if (isFlatpak) {
    vfsFilePath = path.join("/var/run/host", filePath);
  }
  logger.debug("Checking file presence", { filePath, vfsFilePath });
  return fs.existsSync(vfsFilePath);
}

async function createWrapper(opts, launcher, args) {
  let wrapper;
  if (opts?.wrapper) {
    if (typeof opts.wrapper === "function") {
      wrapper = await opts.wrapper(launcher, args);
    } else {
      wrapper = opts.wrapper;
    }
  }
  return wrapper;
}

function wrapSpawnAsync(launcher, launcherArgs, launcherOpts) {
  let spawnLauncher;
  let spawnArgs;
  let spawnOpts;
  if (isFlatpak) {
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
    logger.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path must be set");
  }
  if (typeof spawnLauncher !== "string") {
    logger.error("[SC.A][>]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
    throw new Error("Launcher path has invalid type");
  }
  logger.debug("[SC.A][>][spawn]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts });
  const child = spawn(spawnLauncher, spawnArgs, spawnLauncherOpts);
  child.command = command;
  logger.debug("[SC.A][<][spawn]", command, { spawnLauncher, spawnArgs, spawnLauncherOpts }, { pid: child.pid });
  return child;
}

function wrapSpawnSync(launcher, launcherArgs, launcherOpts) {
  let spawnLauncher;
  let spawnArgs;
  let spawnOpts;
  if (isFlatpak) {
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
  // logger.debug("[SC.S][>]", command);
  logger.debug("[SC.S][>][spawnSync]", command);
  const child = spawnSync(spawnLauncher, spawnArgs, spawnLauncherOpts);
  child.command = command;
  return child;
}

async function exec_launcher_async(launcher, launcherArgs, opts) {
  const launcherOpts = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env,
    detached: opts?.detached
  };
  const wrapper_next = await createWrapper(opts, launcher, launcherArgs);
  return new Promise((resolve) => {
    let resolved = false;
    const process = {
      pid: null,
      code: null,
      success: false,
      stdout: "",
      stderr: "",
      command: "" // Decorated by child process
    };

    const child = wrapper_next
      ? wrapSpawnAsync(wrapper_next.launcher, wrapper_next.args, launcherOpts)
      : wrapSpawnAsync(launcher, launcherArgs, launcherOpts);
    const processResolve = (from, data) => {
      if (resolved) {
        logger.error(child.command, "spawning already resolved", { from, data });
      } else {
        process.pid = child.pid;
        process.code = child.exitCode;
        process.stderr = process.stderr || "";
        process.success = child.exitCode === 0;
        process.command = child.command;
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
      logger.error(child.command, "spawning error", error);
      process.error = error;
    });
    child.stdout.on("data", (data) => {
      // logger.debug(child.command, "spawning stdout", data);
      process.stdout += `${data}`;
    });
    child.stderr.on("data", (data) => {
      // logger.error(child.command, "spawning stderr", data);
      process.stderr += `${data}`;
    });
  });
}

async function exec_launcher_sync(launcher, launcherArgs, opts) {
  const launcherOpts = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env,
    detached: opts?.detached
  };
  const wrapper_next = await createWrapper(opts, launcher, launcherArgs);
  const child = opts?.wrapper
    ? wrapSpawnSync(wrapper_next.launcher, wrapper_next.args, launcherOpts)
    : wrapSpawnSync(launcher, launcherArgs, launcherOpts);
  const process = {
    pid: child.pid,
    code: child.status,
    success: child.status === 0,
    stdout: child.stdout,
    stderr: child.stderr,
    command: child.command
  };
  logger.debug("[SC.S][<]", process);
  return process;
}

async function exec_launcher(launcher, launcherArgs, opts) {
  return await exec_launcher_async(launcher, launcherArgs, opts);
}

async function exec_service(opts) {
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
  const em = new events.EventEmitter();
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
      // logger.debug("Child process exit", code);
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (child, code) => {
      // logger.debug("Child process close", code);
      em.emit("close", { code });
    };
    const onProcessData = (child, from, data) => {
      // logger.debug("Child process data", child.pid, from, data);
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
          } catch (error) {
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
    const onStart = () => {
      const launcherOpts = {
        encoding: "utf-8",
        cwd: opts?.cwd,
        env: opts?.env
      };
      child = wrapSpawnAsync(programPath, programArgs, launcherOpts);
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

module.exports = {
  isFilePresent,
  wrapSpawnAsync,
  wrapSpawnSync,
  exec_launcher_async,
  exec_launcher_sync,
  exec_launcher,
  exec_service
};
