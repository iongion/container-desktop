// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/native");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");
const FIXTURE_PODMAN_MACHINE = "podman-machine-default";
const FIXTURE_IDENTITY_PATH = path.join(process.env.HOME, ".ssh", FIXTURE_PODMAN_MACHINE);
const EXPECTED_MACHINES_LINUX = [
  {
    CPUs: 1,
    Default: true,
    IdentityPath: FIXTURE_IDENTITY_PATH,
    Name: FIXTURE_PODMAN_MACHINE,
    // Port: 43861,
    RemoteUsername: "core",
    Running: true,
    Stream: "testing",
    VMType: "qemu"
  }
];
const EXPECTED_MACHINES_WINDOWS = [];
const EXPECTED_MACHINES_MACOS = [];
const EXPECTED_SYSTEM_INFO_LINUX = {
  host: {
    arch: "amd64",
    buildahVersion: "1.24.3",
    cgroupManager: "systemd",
    cgroupVersion: "v2"
  },
  version: {
    APIVersion: "4.0.3",
    GoVersion: "go1.18",
    OsArch: "linux/amd64",
    Version: "4.0.3"
  }
};
const EXPECTED_SYSTEM_INFO_WINDOWS = {};
const EXPECTED_SYSTEM_INFO_MACOS = {};
const EXPECTED_SYSTEM_CONNECTIONS_LINUX = [
  {
    Default: true,
    Identity: FIXTURE_IDENTITY_PATH,
    Name: FIXTURE_PODMAN_MACHINE
    // URI: "ssh://core@localhost:43861/run/user/1000/podman/podman.sock"
  },
  {
    Default: false,
    Identity: FIXTURE_IDENTITY_PATH,
    Name: `${FIXTURE_PODMAN_MACHINE}-root`
    // URI: "ssh://root@localhost:43861/run/podman/podman.sock"
  }
];
const EXPECTED_SYSTEM_CONNECTIONS_WINDOWS = [];
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

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
        baseURL: "http://d/v3.0.0/libpod",
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
        baseURL: "http://d/v3.0.0/libpod",
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
