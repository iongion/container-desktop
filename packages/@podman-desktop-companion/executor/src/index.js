const os = require("os");
const { spawn } = require("child_process");
const events = require("events");
// vendors

function wrapLauncher(program, args, opts = { useWSL: false, useLima: false }) {
  const osType = os.type();
  let launcher = program;
  let launcherArgs = args;
  if (osType === "Windows_NT" && opts?.useWSL) {
    launcher = "wsl.exe";
    launcherArgs = [program].concat(args);
  } else if (osType === "Darwin" && opts?.useLima) {
    launcher = "lima";
    launcherArgs = [program].concat(args);
  }
  return [launcher, launcherArgs];
}

// project
async function exec_launcher(launcher, launcherArgs, opts) {
  const launcherOpts = {
    encoding: "utf-8", // TODO: cNot working for spawn - find alternative
    cwd: opts?.cwd,
    env: opts?.env
  };
  let resolved = false;
  const result = await new Promise((resolve) => {
    const command = [launcher].concat(launcherArgs).join(" ");
    const process = {
      pid: null,
      code: null,
      success: false,
      stdout: "",
      stderr: "",
      command
    };
    console.debug("Spawning started", command);
    const child = spawn(launcher, launcherArgs, launcherOpts);
    const processResolve = (from, data) => {
      if (resolved) {
        // console.warn("Spawning already resolved", { command, from, data });
      } else {
        console.debug(`Spawning complete: "${command}"`, { from, data });
        process.code = child.exitCode;
        process.stderr = process.stderr || data;
        resolved = true;
        resolve(process);
      }
    };
    process.pid = child.pid;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.on("exit", (code) => processResolve("exit", code));
    child.on("close", (code) => processResolve("close", code));
    child.on("error", (error) => processResolve("error", error));
    child.stdout.on("data", (data) => (process.stdout += `${data}`));
    child.stderr.on("data", (data) => (process.stderr += `${data}`));
    if (typeof child.pid === "undefined") {
      process.success = false;
    } else {
      process.success = true;
    }
  });
  return result;
}

async function exec(program, args, opts) {
  const [launcher, launcherArgs] = wrapLauncher(program, args);
  return exec_launcher(launcher, launcherArgs, opts);
}

async function which(program) {
  let output;
  const finder = os.type() === "Windows_NT" ? "where" : "which";
  const result = await exec(finder, [program]);
  if (result.success) {
    output = `${result.stdout}`.trim();
    console.debug("Program located", program, result, output);
  } else {
    console.error("Unable to locate program", program, result);
  }
  return output;
}

async function withClient(opts) {
  let isManagedExit = false;
  const process = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: ""
  };
  const { checkStatus, retry, socketPath, programPath } = opts;
  const em = new events.EventEmitter();
  // Check
  const running = await checkStatus();
  if (running) {
    console.debug("Already running - reusing");
    process.success = true;
    setImmediate(() => {
      em.emit("ready", { process });
    });
  } else {
    // Handle
    const onProcessError = (child, error) => {
      // console.error('Child process error', error.code, error.message);
      em.emit("error", { type: "process.error", code: error.code });
    };
    const onProcessExit = (child, code) => {
      // console.debug('Child process exit', code);
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (child, code) => {
      // console.debug('Child process close', code);
      em.emit("close", { code });
    };
    const onProcessData = (child, from, data) => {
      // console.debug('Child process data', from, data);
      em.emit("data", { from, data });
    };
    const waitForProcess = (child) => {
      let retries = retry?.count || 5;
      const wait = retry?.wait || 1000;
      const IID = setInterval(async () => {
        // console.debug('Remaining', retries, 'of', retry?.count);
        if (retries === 0) {
          clearInterval(IID);
          // console.error('Max retries reached');
          em.emit("error", { type: "domain.max-retries", code: undefined });
        } else {
          const running = await checkStatus();
          // console.debug('Checking running first time after start', running);
          if (running) {
            clearInterval(IID);
            // console.debug('Sending SIGHUP', process.pid);
            isManagedExit = true;
            child.kill("SIGHUP");
            const configured = await checkStatus();
            if (configured) {
              process.success = true;
              em.emit("ready", { process });
            } else {
              em.emit("error", { type: "domain.not-configured", code: undefined });
            }
          } else {
            console.debug("Move to next retry", retries);
          }
        }
        retries -= 1;
      }, wait);
    };
    const onStart = () => {
      const args = ["system", "service", "--time=0", `unix://${socketPath}`, "--log-level=debug"];
      const [launcher, launcherArgs] = wrapLauncher(programPath, args);
      const launcherOpts = {
        encoding: "utf-8",
        cwd: opts?.cwd,
        env: opts?.env
      };
      console.debug("Spawning launcher", [launcher].concat(launcherArgs).join(" "), launcherOpts);
      const child = spawn(launcher, launcherArgs, launcherOpts);
      process.pid = child.pid;
      child.on("exit", (code) => onProcessExit(child, code));
      child.on("close", (code) => onProcessClose(child, code));
      child.on("error", (error) => onProcessError(child, error));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => onProcessData(child, "stdout", data.toString()));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data) => onProcessData(child, "stderr", data.toString()));
      if (typeof child.pid === "undefined") {
        process.success = false;
        // console.error('Child process spawn failure', process);
      } else {
        process.success = true;
        // console.debug('Child process spawn success', process);
        waitForProcess(child);
      }
    };
    em.on("start", onStart);
    em.emit("start");
  }
  return em;
}

module.exports = {
  exec,
  exec_launcher,
  which,
  withClient
};
