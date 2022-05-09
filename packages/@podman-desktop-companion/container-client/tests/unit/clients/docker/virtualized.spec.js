// node
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/docker/virtualized");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");
// fixtures
const EXPECTED_MACHINES_LINUX = [];
const EXPECTED_MACHINES_WINDOWS = [];
const EXPECTED_MACHINES_MACOS = [];
const EXPECTED_SYSTEM_INFO_LINUX = {};
const EXPECTED_SYSTEM_INFO_WINDOWS = {
  Architecture: "x86_64",
  CgroupDriver: "cgroupfs",
  CgroupVersion: "1",
  IndexServerAddress: "https://index.docker.io/v1/",
  InitBinary: "docker-init",
  Name: "docker-desktop",
  OSType: "linux",
  OperatingSystem: "Docker Desktop"
};
const EXPECTED_SYSTEM_INFO_MACOS = {
  Architecture: "x86_64",
  CgroupDriver: "cgroupfs",
  CgroupVersion: "1",
  IndexServerAddress: "https://index.docker.io/v1/",
  InitBinary: "docker-init",
  Name: "docker-desktop",
  OSType: "linux",
  OperatingSystem: "Docker Desktop"
};
const EXPECTED_SYSTEM_CONNECTIONS_LINUX = [];
const EXPECTED_SYSTEM_CONNECTIONS_WINDOWS = [];
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

describe("Docker.Virtualized.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Docker.Virtualized.ContainerClient");
  });
  describe("getMachines", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_LINUX);
    });
    testOnWindows("Windows", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_WINDOWS);
    });
    testOnMacOS("MacOS", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_MACOS);
    });
  });
  describe("getSystemInfo", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_LINUX);
    });
    testOnWindows("Windows", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_WINDOWS);
    });
    testOnMacOS("MacOS", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_MACOS);
    });
  });
  describe("getSystemConnections", () => {
    testOnLinux("Linux", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_LINUX);
    });
    testOnWindows("Windows", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_WINDOWS);
    });
    testOnMacOS("MacOS", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_MACOS);
    });
  });
});
