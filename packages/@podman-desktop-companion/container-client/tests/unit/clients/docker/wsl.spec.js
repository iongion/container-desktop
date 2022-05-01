// node
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/docker/wsl");
// locals
const { testOnWindows } = require("../../../helpers");
const {
  DOCKER_CLI_VERSION,
  // WSL - Windows
  WSL_DISTRIBUTION, // Default WSL distribution (Ubuntu-20.04)
  WSL_DISTRIBUTIONS
} = require("../../../fixtures");
// fixtures
const EXPECTED_MACHINES_WSL = [];
const EXPECTED_SYSTEM_INFO_WSL = {
  Architecture: "x86_64",
  BridgeNfIp6tables: true,
  BridgeNfIptables: true,
  CPUSet: true,
  CPUShares: true,
  CgroupDriver: "cgroupfs",
  CgroupVersion: "1",
  KernelVersion: "5.10.16.3-microsoft-standard-WSL2",
  OSType: "linux",
  OperatingSystem: "Docker Desktop",
  ServerVersion: DOCKER_CLI_VERSION
};
const EXPECTED_SYSTEM_CONNECTIONS_WSL = [];

describe("Docker.WSL.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Docker.WSL.ContainerClient", WSL_DISTRIBUTION);
  });
  describe("getMachines", () => {
    testOnWindows("Windows", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_WSL);
    });
  });
  describe("getSystemInfo", () => {
    testOnWindows("Windows", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_WSL);
    });
  });
  describe("getSystemConnections", () => {
    testOnWindows("Windows", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_WSL);
    });
  });

  describe("getAvailableDistributions", () => {
    testOnWindows("Windows", async () => {
      const path = await client.getAvailableDistributions();
      expect(path).toEqual(WSL_DISTRIBUTIONS);
    });
  });
});
