// node
// project
// modules
const { findProgramPath, findProgramVersion, findProgram } = require("../../src/detector");
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
  PODMAN_CLI_VERSION,
  // Native - Linux
  NATIVE_DOCKER_CLI_PATH,
  NATIVE_PODMAN_CLI_PATH,
  // Virtualized - MacOS
  MACOS_PODMAN_NATIVE_CLI_VERSION,
  MACOS_PODMAN_NATIVE_CLI_PATH,
  MACOS_DOCKER_NATIVE_CLI_VERSION,
  MACOS_DOCKER_NATIVE_CLI_PATH,
  // Virtualized - Windows
  WINDOWS_PODMAN_NATIVE_CLI_VERSION,
  WINDOWS_PODMAN_NATIVE_CLI_PATH,
  // LIMA - MacOS
  LIMA_VERSION,
  LIMA_PATH
} = require("../fixtures");

jest.setTimeout(50000); // Give time for windows testing VM

// beforeAll(async () => {
//   await ensurePodmanMachineIsRunning();
//   await ensureLIMAInstanceIsRunning();
// });

describe("detector", () => {
  // findProgramPath
  testOnLinux("findProgramPath", async () => {
    const podmanPath = await findProgramPath("podman");
    expect(podmanPath).toBe(NATIVE_PODMAN_CLI_PATH);
    const dockerPath = await findProgramPath("docker");
    expect(dockerPath).toBe(NATIVE_DOCKER_CLI_PATH);
  });
  testOnWindows("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe(WINDOWS_PODMAN_NATIVE_CLI_PATH);
  });
  testOnMacOS("findProgramPath", async () => {
    const podmanPath = await findProgramPath("podman");
    expect(podmanPath).toBe(MACOS_PODMAN_NATIVE_CLI_PATH);
    const dockerPath = await findProgramPath("docker");
    expect(dockerPath).toBe(MACOS_DOCKER_NATIVE_CLI_PATH);
    const limaPath = await findProgramPath("limactl");
    expect(limaPath).toBe(LIMA_PATH);
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
    expect(path).toBe(WINDOWS_PODMAN_NATIVE_CLI_VERSION);
  });
  testOnMacOS("findProgramVersion", async () => {
    const podmanVersion = await findProgramVersion("podman");
    expect(podmanVersion).toBe(MACOS_PODMAN_NATIVE_CLI_VERSION);
    const dockerVersion = await findProgramVersion("docker");
    expect(dockerVersion).toBe(MACOS_DOCKER_NATIVE_CLI_VERSION);
    const limaVersion = await findProgramVersion("limactl");
    expect(limaVersion).toBe(LIMA_VERSION);
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
  // findProgram
  testOnMacOS("findProgram", async () => {
    const podman = await findProgram("podman");
    expect(podman).toStrictEqual({
      name: "podman",
      path: MACOS_PODMAN_NATIVE_CLI_PATH,
      version: MACOS_PODMAN_NATIVE_CLI_VERSION
    });
    const docker = await findProgram("docker");
    expect(docker).toStrictEqual({
      name: "docker",
      path: MACOS_DOCKER_NATIVE_CLI_PATH,
      version: MACOS_DOCKER_NATIVE_CLI_VERSION
    });
    const lima = await findProgram("limactl");
    expect(lima).toStrictEqual({
      name: "limactl",
      path: LIMA_PATH,
      version: LIMA_VERSION
    });
  });
});
