// node
import os from "node:os";
// project
import { exec_launcher_async } from "@/executor";

const OS_CURRENT = os.type();
const testOnLinux = OS_CURRENT === "Linux" ? test : test.skip;
const testOnDarwin = OS_CURRENT === "Darwin" ? test : test.skip;
const testOnUnix = OS_CURRENT === "Linux" || OS_CURRENT === "Darwin" ? test : test.skip;
const testOnWindows = OS_CURRENT === "Windows_NT" ? test : test.skip;
const testOnMacOS = testOnDarwin;

async function ensurePodmanMachineIsRunning() {
  let result;
  console.debug("Ensuring podman machine is running");
  // Stop for clean-up
  result = await exec_launcher_async("podman", ["machine", "stop", "podman-machine-default"]);
  result = await exec_launcher_async("podman", ["machine", "stop", "podman-machine-default"]);
  if (result.success) {
    console.debug("Ensuring podman machine is running - existing machine was stopped", result);
  } else {
    console.debug("Ensuring podman machine is running - unable to stop", result);
  }
  // Start for requirement
  result = await exec_launcher_async("podman", ["machine", "start", "podman-machine-default"]);
  if (result.success) {
    console.debug("Ensuring podman machine is running - new machine was started", result);
    return result;
  }
  console.error("Ensuring podman machine is running - unable to start", result);
  throw new Error("Unable to start required podman machine");
}

async function ensureLIMAInstanceByNameIsRunning(name) {
  let result;
  console.debug(`Ensuring lima ${name} instance is running`);
  if (OS_CURRENT !== "Darwin") {
    console.debug(`Ensuring lima ${name} instance is running - skipped(only on Darwin)`);
    return;
  }
  // Stop for clean-up
  result = await exec_launcher_async("limactl", ["stop", "-f", name]);
  if (!result.success) {
    console.debug(`Ensuring lima ${name} instance is running - unable to stop`, result);
  }
  // Start for requirement
  result = await exec_launcher_async("limactl", ["start", name]);
  if (!result.success) {
    console.error(`Ensuring lima ${name} instance is running - unable to start`, result);
    throw new Error("Unable to start required lima instance");
  }
}

async function ensureLIMAInstanceIsRunning() {
  await ensureLIMAInstanceByNameIsRunning("podman");
  await ensureLIMAInstanceByNameIsRunning("docker");
}

export default {
  testOnUnix,
  testOnLinux,
  testOnWindows,
  testOnDarwin,
  testOnMacOS,
  ensurePodmanMachineIsRunning,
  ensureLIMAInstanceIsRunning
};
