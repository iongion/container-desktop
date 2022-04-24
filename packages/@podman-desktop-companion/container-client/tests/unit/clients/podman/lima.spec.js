// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/lima");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../../../helpers");
const FIXTURE_LIMA_INSTANCE = "podman";

const EXPECTED_MACHINES_MACOS = [];
const EXPECTED_SYSTEM_INFO_MACOS = {};
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

jest.setTimeout(120000);

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
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        socketPath: path.join(process.env.HOME, ".lima/podman/sock/podman.sock"),
        timeout: 60000
      });
    });
  });
  describe("getApiDriver", () => {
    testOnMacOS("MacOS", async () => {
      const driver = await client.getApiDriver();
      expect(driver).toHaveProperty("defaults");
      expect(driver.defaults).toMatchObject({
        baseURL: "http://d/v3.0.0/libpod",
        socketPath: path.join(process.env.HOME, ".lima/podman/sock/podman.sock")
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
  // describe("isApiRunning", () => {
  //   beforeEach(async () => {
  //     await client.stopApi();
  //   });
  //   afterEach(async () => {
  //     await client.stopApi();
  //   });
  //   testOnMacOS("MacOS - stop / start and check status", async () => {
  //     let received;
  //     // Stop
  //     await client.stopApi();
  //     received = await client.isApiRunning();
  //     expect(received).toStrictEqual({
  //       details: "API scope is not available",
  //       success: false
  //     });
  //     // Start
  //     await client.startApi();
  //     received = await client.isApiRunning();
  //     expect(received).toStrictEqual({
  //       details: "OK",
  //       success: true
  //     });
  //   });
  // });
});
