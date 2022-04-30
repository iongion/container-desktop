// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/native");
// locals
const { testOnLinux } = require("../../../helpers");
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
} = require("../../../fixtures");
const FIXTURE_IDENTITY_PATH = path.join(process.env.HOME, ".ssh", PODMAN_MACHINE_DEFAULT);
const EXPECTED_MACHINES_LINUX = [
  {
    CPUs: 1,
    Default: true,
    IdentityPath: FIXTURE_IDENTITY_PATH,
    Name: PODMAN_MACHINE_DEFAULT,
    // Port: 43861,
    RemoteUsername: "core",
    Running: true,
    Stream: "testing",
    VMType: "qemu"
  }
];
const EXPECTED_SYSTEM_INFO_LINUX = {
  host: {
    arch: "amd64",
    buildahVersion: "1.24.3",
    cgroupManager: "systemd",
    cgroupVersion: "v2"
  },
  version: {
    APIVersion: PODMAN_CLI_VERSION,
    GoVersion: "go1.18",
    OsArch: "linux/amd64",
    Version: PODMAN_CLI_VERSION
  }
};
const EXPECTED_SYSTEM_CONNECTIONS_LINUX = [
  {
    Default: true,
    Identity: FIXTURE_IDENTITY_PATH,
    Name: PODMAN_MACHINE_DEFAULT
  },
  {
    Default: false,
    Identity: FIXTURE_IDENTITY_PATH,
    Name: `${PODMAN_MACHINE_DEFAULT}-root`
  }
];

jest.setTimeout(30000);

describe("Podman.Native.ContainerClient", () => {
  let configuration;
  let client;
  let settings;
  beforeEach(async () => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.ContainerClient.podman.native");
    settings = await client.getCurrentSettings();
  });
  describe("getMachines", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_LINUX);
    });
  });
  describe("getSystemInfo", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_LINUX);
    });
  });
  describe("getSystemConnections", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_LINUX);
    });
  });
  describe("getApiConfig", () => {
    testOnLinux("Linux", async () => {
      const config = await client.getApiConfig();
      expect(config).toStrictEqual({
        baseURL: PODMAN_API_BASE_URL,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        socketPath: "/tmp/podman-desktop-companion-podman-rest-api.sock",
        timeout: 60000
      });
    });
  });
  describe("getApiDriver", () => {
    testOnLinux("Linux", async () => {
      const driver = await client.getApiDriver();
      expect(driver).toHaveProperty("defaults");
      expect(driver.defaults).toMatchObject({
        baseURL: PODMAN_API_BASE_URL,
        socketPath: "/tmp/podman-desktop-companion-podman-rest-api.sock"
      });
    });
  });
  describe("isApiRunning", () => {
    testOnLinux("Linux - not running", async () => {
      const received = await client.isApiRunning();
      expect(received).toStrictEqual({
        success: false,
        details: "API is not available"
      });
    });
  });
});
