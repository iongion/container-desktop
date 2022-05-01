// node
// vendors
// project
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/podman/virtualized");
// locals
const {
  testOnLinux,
  testOnWindows,
  testOnMacOS
  // ensurePodmanMachineIsRunning,
  // ensureLIMAInstanceIsRunning
} = require("../../../helpers");
const { PODMAN_MACHINE_DEFAULT, PODMAN_CLI_VERSION } = require("../../../fixtures");
// fixtures
const EXPECTED_MACHINES_LINUX = [
  {
    Default: true,
    Name: PODMAN_MACHINE_DEFAULT,
    RemoteUsername: "core",
    Stream: "testing",
    VMType: "qemu"
  }
];
const EXPECTED_MACHINES_WINDOWS = [
  {
    Default: true,
    Name: PODMAN_MACHINE_DEFAULT,
    RemoteUsername: "",
    Stream: "35",
    VMType: "wsl"
  }
];
const EXPECTED_MACHINES_MACOS = [
  {
    Default: true,
    Name: PODMAN_MACHINE_DEFAULT,
    RemoteUsername: "core",
    Stream: "testing",
    VMType: "qemu"
  }
];
const EXPECTED_SYSTEM_INFO_LINUX = {
  host: {
    arch: "amd64",
    buildahVersion: "1.24.3",
    cgroupManager: "systemd",
    cgroupVersion: "v2",
    distribution: {
      distribution: "fedora",
      variant: "coreos",
      version: "36"
    }
  },
  version: {
    APIVersion: PODMAN_CLI_VERSION,
    OsArch: "linux/amd64",
    Version: PODMAN_CLI_VERSION
  }
};
const EXPECTED_SYSTEM_INFO_WINDOWS = {
  host: {
    arch: "amd64",
    buildahVersion: "1.24.3",
    cgroupManager: "cgroupfs",
    cgroupVersion: "v1",
    distribution: {
      distribution: "fedora",
      variant: "container",
      version: "35"
    }
  },
  version: {
    APIVersion: PODMAN_CLI_VERSION,
    OsArch: "linux/amd64",
    Version: PODMAN_CLI_VERSION
  }
};
const EXPECTED_SYSTEM_INFO_MACOS = {
  host: {
    arch: "amd64",
    buildahVersion: "1.24.1",
    cgroupManager: "systemd",
    cgroupVersion: "v2",
    distribution: {
      distribution: "fedora",
      variant: "coreos",
      version: "35"
    }
  },
  version: {
    APIVersion: "4.0.2",
    OsArch: "linux/amd64",
    Version: "4.0.2"
  }
};
const EXPECTED_SYSTEM_CONNECTIONS_LINUX = [];
const EXPECTED_SYSTEM_CONNECTIONS_WINDOWS = [];
const EXPECTED_SYSTEM_CONNECTIONS_MACOS = [];

jest.setTimeout(30000);

// beforeAll(async () => {
//   await ensurePodmanMachineIsRunning();
//   await ensureLIMAInstanceIsRunning();
// });

describe("Podman.Virtualized.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(async () => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Podman.Virtualized.ContainerClient");
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
  describe("isApiRunning", () => {
    test("Everywhere", async () => {
      const received = await client.isApiRunning();
      expect(received).toStrictEqual({
        details: "OK",
        success: true
      });
    });
  });
});
