// node
// project
// modules
const { findProgramPath, findProgramVersion } = require("../../src/detector");
// locals
const {
  testOnLinux,
  testOnWindows,
  testOnMacOS
  // ensurePodmanMachineIsRunning,
  // ensureLIMAInstanceIsRunning
} = require("../helpers");
const {
  NATIVE_PODMAN_CLI_PATH,
  WINDOWS_PODMAN_CLI_PATH,
  PODMAN_CLI_VERSION,
  PODMAN_MACHINE_DEFAULT
} = require("../fixtures");

jest.setTimeout(120000);

// beforeAll(async () => {
//   await ensurePodmanMachineIsRunning();
//   await ensureLIMAInstanceIsRunning();
// });

describe("detector", () => {
  // findProgramPath
  testOnLinux("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe(NATIVE_PODMAN_CLI_PATH);
  });
  testOnWindows("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe(WINDOWS_PODMAN_CLI_PATH);
  });
  testOnMacOS("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe("/usr/local/bin/podman");
  });
  testOnLinux("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe(NATIVE_PODMAN_CLI_PATH);
  });
  testOnWindows("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe(NATIVE_PODMAN_CLI_PATH);
  });
  testOnMacOS("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe(NATIVE_PODMAN_CLI_PATH);
  });
  // findProgramVersion
  testOnLinux("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe(PODMAN_CLI_VERSION);
  });
  testOnWindows("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe(WINDOWS_PODMAN_CLI_VERSION);
  });
  testOnMacOS("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe(PODMAN_CLI_VERSION);
  });
  testOnLinux("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe(PODMAN_CLI_VERSION);
  });
  testOnWindows("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe(PODMAN_CLI_VERSION);
  });
  testOnMacOS("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", PODMAN_MACHINE_DEFAULT]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe("4.0.2");
  });
});
