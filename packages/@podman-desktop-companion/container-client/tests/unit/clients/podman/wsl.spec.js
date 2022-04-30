// node
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/wsl");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");

const EXPECTED_MACHINES_WSL = [];
const EXPECTED_SYSTEM_INFO_WSL = {
  host: {
    arch: "amd64",
    distribution: {
      distribution: "ubuntu",
      version: "20.04"
    }
  }
};
const EXPECTED_SYSTEM_CONNECTIONS_WSL = [];

jest.setTimeout(30000);

describe("Podman.WSL.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Podman.WSL.ContainerClient", WSL_DISTRIBUTION);
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
      const path = await getAvailableDistributions();
      expect(path).toEqual([
        {
          Current: false,
          Default: true,
          Name: "Ubuntu-20.04",
          State: "Running",
          Version: "2"
        },
        {
          Current: false,
          Default: false,
          Name: "docker-desktop-data",
          State: "Running",
          Version: "2"
        },
        {
          Current: false,
          Default: false,
          Name: PODMAN_MACHINE_DEFAULT,
          State: "Running",
          Version: "2"
        },
        {
          Current: false,
          Default: false,
          Name: "docker-desktop",
          State: "Running",
          Version: "2"
        }
      ]);
    });
  });
});
