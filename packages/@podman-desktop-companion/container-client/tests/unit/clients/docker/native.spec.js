// node
const path = require("path");
// module
const { UserConfiguration } = require("../../../../src/configuration");
const { ContainerClient } = require("../../../../src/clients/docker/native");
// locals
const { testOnLinux } = require("../../../helpers");
const EXPECTED_MACHINES_LINUX = [];
const EXPECTED_SYSTEM_INFO_LINUX = {
  Architecture: "x86_64",
  BridgeNfIp6tables: true,
  BridgeNfIptables: true,
  CPUSet: true,
  CPUShares: true,
  CgroupDriver: "systemd",
  CgroupVersion: "2",
  CpuCfsPeriod: true,
  CpuCfsQuota: true,
  Debug: false,
  DefaultRuntime: "runc",
  IndexServerAddress: "https://index.docker.io/v1/",
  InitBinary: "docker-init",
  OSType: "linux",
  RegistryConfig: {
    AllowNondistributableArtifactsCIDRs: [],
    AllowNondistributableArtifactsHostnames: [],
    IndexConfigs: {
      "docker.io": {
        Mirrors: [],
        Name: "docker.io",
        Official: true,
        Secure: true
      }
    },
    InsecureRegistryCIDRs: ["127.0.0.0/8"],
    Mirrors: []
  },
  RuncCommit: {
    Expected: "",
    ID: ""
  },
  Runtimes: {
    "io.containerd.runc.v2": {
      path: "runc"
    },
    "io.containerd.runtime.v1.linux": {
      path: "runc"
    },
    runc: {
      path: "runc"
    }
  },
  SecurityOptions: ["name=apparmor", "name=seccomp,profile=default", "name=cgroupns"],
  ServerVersion: "20.10.14"
};
const EXPECTED_SYSTEM_CONNECTIONS_LINUX = [];

jest.setTimeout(30000);

describe("Docker.Native.ContainerClient", () => {
  let configuration;
  let client;
  beforeEach(() => {
    configuration = new UserConfiguration();
    configuration.reset();
    client = new ContainerClient(configuration, "testing.Docker.Native.ContainerClient");
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
});
