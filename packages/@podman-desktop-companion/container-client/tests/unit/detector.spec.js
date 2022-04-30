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
  PODMAN_MACHINE_DEFAULT,
  NATIVE_DOCKER_CLI_PATH,
  NATIVE_PODMAN_CLI_PATH,
  WINDOWS_PODMAN_CLI_VERSION,
  WINDOWS_PODMAN_CLI_PATH,
  WINDOWS_DOCKER_CLI_PATH,
  WINDOWS_PODMAN_NAMED_PIPE,
  WINDOWS_DOCKER_NAMED_PIPE,
  PODMAN_CLI_VERSION,
  DOCKER_CLI_VERSION,
  PODMAN_API_BASE_URL,
  DOCKER_API_BASE_URL,
  NATIVE_DOCKER_SOCKET_PATH,
  NATIVE_PODMAN_SOCKET_PATH,
  // WSL
  WSL_DISTRIBUTION,
  WSL_PATH,
  WSL_PODMAN_CLI_PATH,
  WSL_PODMAN_CLI_VERSION,
  WSL_PODMAN_NAMED_PIPE,
  WSL_DOCKER_NAMED_PIPE,
  // LIMA
  LIMA_PATH,
  LIMA_DOCKER_CLI_PATH,
  LIMA_DOCKER_CLI_VERSION,
  LIMA_PODMAN_CLI_PATH,
  LIMA_PODMAN_CLI_VERSION,
  LIMA_DOCKER_INSTANCE,
  LIMA_PODMAN_INSTANCE,
  LIMA_DOCKER_SOCKET_PATH,
  LIMA_PODMAN_SOCKET_PATH,
  LIMA_INSTANCES
} = require("../fixtures");

jest.setTimeout(50000); // Give time for windows testing VM

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
