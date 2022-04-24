// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/wsl");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");
const FIXTURE_PODMAN_MACHINE = "podman-machine-default";
const FIXTURE_IDENTITY_PATH = path.join(process.env.HOME, ".ssh", FIXTURE_PODMAN_MACHINE);

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
    client = new ContainerClient(configuration, "testing.Podman.WSL.ContainerClient");
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
});
