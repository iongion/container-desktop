// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/docker/lima");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");
const FIXTURE_LIMA_INSTANCE = "docker";

const EXPECTED_MACHINES_MACOS = [];
const EXPECTED_SYSTEM_INFO_MACOS = {};
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

jest.setTimeout(30000);

describe("Docker.LIMA.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Docker.LIMA.ContainerClient");
  });
  describe("getMachines", () => {
    testOnMacOS("MacOS", async () => {
      const info = await client.getMachines();
      expect(info).toMatchObject(EXPECTED_MACHINES_MACOS);
    });
  });
  describe("getSystemInfo", () => {
    testOnMacOS("MacOS", async () => {
      const info = await client.getSystemInfo();
      expect(info).toMatchObject(EXPECTED_SYSTEM_INFO_MACOS);
    });
  });
  describe("getSystemConnections", () => {
    testOnMacOS("MacOS", async () => {
      const info = await client.getSystemConnections();
      expect(info).toMatchObject(EXPECTED_SYSTEM_CONNECTIONS_MACOS);
    });
  });
});
