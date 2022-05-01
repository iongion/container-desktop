// node
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/lima");
// locals
const { testOnMacOS } = require("../../../helpers");
const { PODMAN_API_BASE_URL, LIMA_PODMAN_SOCKET_PATH, LIMA_INSTANCES } = require("../../../fixtures");
// fixtures
const EXPECTED_MACHINES_MACOS = [];
const EXPECTED_SYSTEM_INFO_MACOS = {};
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

describe("Podman.LIMA.ContainerClient", () => {
  let configuration;
  let client;
  let settings;
  beforeEach(async () => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.ContainerClient.podman.lima");
    settings = await client.getCurrentSettings();
  });
  describe("getAvailableInstances", () => {
    testOnMacOS("MacOS", async () => {
      const items = await client.getAvailableInstances();
      expect(items).toMatchObject(LIMA_INSTANCES);
    });
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
  describe("getApiConfig", () => {
    testOnMacOS("MacOS", async () => {
      const config = await client.getApiConfig();
      expect(config).toStrictEqual({
        baseURL: PODMAN_API_BASE_URL,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        socketPath: LIMA_PODMAN_SOCKET_PATH,
        timeout: 60000
      });
    });
  });
  describe("getApiDriver", () => {
    testOnMacOS("MacOS", async () => {
      const driver = await client.getApiDriver();
      expect(driver).toHaveProperty("defaults");
      expect(driver.defaults).toMatchObject({
        baseURL: PODMAN_API_BASE_URL,
        socketPath: LIMA_PODMAN_SOCKET_PATH
      });
    });
  });
  describe("isApiRunning", () => {
    testOnMacOS("MacOS", async () => {
      const received = await client.isApiRunning();
      expect(received).toStrictEqual({
        details: "OK",
        success: true
      });
    });
  });
});
