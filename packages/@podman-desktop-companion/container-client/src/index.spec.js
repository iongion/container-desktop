const os = require("os");
const path = require("path");
const assert = require("assert");
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
const userSettings = require("@podman-desktop-companion/user-settings");

const {
  ENGINE_NATIVE,
  ENGINE_REMOTE, // TODO
  ENGINE_VIRTUALIZED,
  ENGINE_SUBSYSTEM_LIMA,
  ENGINE_SUBSYSTEM_WSL, // TODO
  Backend
} = require("./program");

// Podman machine must be started when testing linux

const PROGRAM_VERSION_LINUX_NATIVE = "4.0.3";
const PROGRAM_VERSION_LINUX_VIRTUALIZED = "4.0.2";
const PROGRAM_VERSION_DARWIN_VIRTUALIZED = "4.0.3";
const PROGRAM_VERSION_DARWIN_SUBSYSTEM_LIMA = "3.2.1";
const PROGRAM_VERSION_WINDOWS_VIRTUALIZED = "4.0.3-dev";
const PROGRAM_PATH_WINDOWS_VIRTUALIZED = "C:\\Program Files\\RedHat\\Podman\\podman.exe";

const PODMAN_MACHINE_DEFAULT = "podman-machine-default";

const OS_CURRENT = os.type();
const testOnLinux = OS_CURRENT === "Linux" ? test : test.skip;
const testOnDarwin = OS_CURRENT === "Darwin" ? test : test.skip;
const testOnWindows = OS_CURRENT === "Windows_NT" ? test : test.skip;

beforeAll(async () => {
  if (OS_CURRENT === "Darwin") {
    await exec_launcher("limactl", ["start", "podman"]);
  }
  await exec_launcher("podman", ["machine", "start", PODMAN_MACHINE_DEFAULT]);
}, 60000);

afterAll(async () => {
  if (OS_CURRENT === "Darwin") {
    await exec_launcher("limactl", ["stop", "podman"]);
  }
  await exec_launcher("podman", ["machine", "stop", PODMAN_MACHINE_DEFAULT]);
}, 60000);

beforeEach(() => {
  userSettings.set("version", "1.0.0");
  userSettings.del("program.name");
  userSettings.del("program.podman.path");
  userSettings.del("program.docker.path");
  userSettings.del("program");
  userSettings.del("engine");
});

test("instantiate", async () => {
  // Assert default program
  const p1 = new Backend();
  expect(p1.getProgramName()).toBe("podman");
  // Assert custom program
  const p2 = new Backend("docker");
  expect(p2.getProgramName()).toBe("docker");
});

describe("detectEngine", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    const engine = await p1.detectEngine();
    expect(engine).toBe(ENGINE_NATIVE);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    const engine = await p1.detectEngine();
    expect(engine).toBe(ENGINE_VIRTUALIZED);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    const engine = await p1.detectEngine();
    expect(engine).toBe(ENGINE_VIRTUALIZED);
  });
});

describe("getEngine.cached", () => {
  testOnLinux("linux.native", async () => {
    userSettings.set("engine", ENGINE_NATIVE);
    const p1 = new Backend();
    const engine = await p1.getEngine(true);
    expect(engine).toBe(ENGINE_NATIVE);
  });
  testOnDarwin("darwin.virtualized", async () => {
    userSettings.set("engine", ENGINE_VIRTUALIZED);
    const p1 = new Backend();
    const engine = await p1.getEngine(true);
    expect(engine).toBe(ENGINE_VIRTUALIZED);
  });
  testOnWindows("windows.virtualized", async () => {
    userSettings.set("engine", ENGINE_VIRTUALIZED);
    const p1 = new Backend();
    const engine = await p1.getEngine(true);
    expect(engine).toBe(ENGINE_VIRTUALIZED);
  });
});

test("setEngine", async () => {
  const p1 = new Backend();
  p1.setOperatingSystemType("Linux");
  await p1.setEngine(ENGINE_VIRTUALIZED);
  const engine = await p1.getEngine();
  expect(engine).toBe(ENGINE_VIRTUALIZED);
});

describe("detectProgramPath", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_NATIVE);
    assert(p1.getOperatingSystemType() === "Linux");
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_NATIVE);
    assert(p1.getOperatingSystemType() === "Linux");
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const path = await p1.detectProgramPath();
    expect(path).toBe("/usr/local/bin/podman");
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const path = await p1.detectProgramPath();
    expect(path).toBe("/usr/bin/podman");
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const path = await p1.detectProgramPath();
    expect(path).toBe(PROGRAM_PATH_WINDOWS_VIRTUALIZED);
  });
});

test("getProgramPath.cached", async () => {
  userSettings.set("program.podman.path", "/my/custom/path");
  const p1 = new Backend();
  const path = await p1.getProgramPath();
  expect(path).toBe("/my/custom/path");
});
test("setProgramPath", async () => {
  const p1 = new Backend();
  await p1.setProgramPath("/the/path");
  const path = await p1.getProgramPath();
  expect(path).toBe("/the/path");
});

describe("detectProgramVersion", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_NATIVE);
    const version = await p1.detectProgramVersion();
    expect(version).toBe(PROGRAM_VERSION_LINUX_NATIVE);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const version = await p1.detectProgramVersion();
    expect(version).toBe(PROGRAM_VERSION_LINUX_VIRTUALIZED);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const version = await p1.detectProgramVersion();
    expect(version).toBe(PROGRAM_VERSION_DARWIN_VIRTUALIZED);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const version = await p1.detectProgramVersion();
    expect(version).toBe(PROGRAM_VERSION_DARWIN_SUBSYSTEM_LIMA);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const version = await p1.detectProgramVersion();
    expect(version).toBe(PROGRAM_VERSION_WINDOWS_VIRTUALIZED);
  });
});

describe("getApiSocketPath", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_NATIVE);
    const connection = await p1.getApiSocketPath();
    expect(connection).toBe("/tmp/podman-desktop-companion-podman-rest-api.sock");
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const connection = await p1.getApiSocketPath();
    const expected = path.join(
      process.env.HOME,
      ".local/share/containers/podman/machine/podman-machine-default/podman.sock"
    );
    expect(connection).toBe(expected);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const connection = await p1.getApiSocketPath();
    const expected = path.join(
      process.env.HOME,
      ".local/share/containers/podman/machine/podman-machine-default/podman.sock"
    );
    expect(connection).toBe(expected);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const connection = await p1.getApiSocketPath();
    const expected = path.join(process.env.HOME, ".lima/podman/sock/podman.sock");
    expect(connection).toBe(expected);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    const connection = await p1.getApiSocketPath();
    const expected = "//./pipe/podman-machine-default";
    expect(connection).toBe(expected);
  });
});

describe("getDescriptor", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_NATIVE);
    await p1.setOperatingSystemType("Linux");
    await p1.setProgramPath("/usr/local/bin/podman");
    const descriptor = await p1.getDescriptor();
    const expected = {
      connection: "/tmp/podman-desktop-companion-podman-rest-api.sock",
      engine: ENGINE_NATIVE,
      name: "podman",
      path: "/usr/local/bin/podman",
      version: PROGRAM_VERSION_LINUX_NATIVE
    };
    expect(descriptor).toMatchObject(expected);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    await p1.setOperatingSystemType("Linux");
    await p1.setProgramPath("/usr/bin/podman");
    const descriptor = await p1.getDescriptor();
    const expected = {
      connection: path.join(
        process.env.HOME,
        ".local/share/containers/podman/machine/podman-machine-default/podman.sock"
      ),
      engine: ENGINE_VIRTUALIZED,
      name: "podman",
      path: "/usr/bin/podman",
      version: PROGRAM_VERSION_LINUX_VIRTUALIZED
    };
    expect(descriptor).toMatchObject(expected);
  });

  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    await p1.setOperatingSystemType("Darwin");
    await p1.setProgramPath("/usr/local/bin/podman");
    const descriptor = await p1.getDescriptor();
    const expected = {
      connection: path.join(
        process.env.HOME,
        ".local/share/containers/podman/machine/podman-machine-default/podman.sock"
      ),
      engine: ENGINE_VIRTUALIZED,
      name: "podman",
      path: "/usr/local/bin/podman",
      version: PROGRAM_VERSION_DARWIN_VIRTUALIZED
    };
    expect(descriptor).toMatchObject(expected);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    await p1.setOperatingSystemType("Darwin");
    // Platform specific assertions
    const programPath = await p1.getProgramPath();
    expect(programPath).toBe("/usr/bin/podman");
    const programVersion = await p1.getProgramVersion();
    expect(programVersion).toBe(PROGRAM_VERSION_DARWIN_SUBSYSTEM_LIMA);
    const descriptor = await p1.getDescriptor();
    const expected = {
      connection: path.join(process.env.HOME, ".lima/podman/sock/podman.sock"),
      engine: ENGINE_SUBSYSTEM_LIMA,
      name: "podman",
      path: "/usr/bin/podman",
      version: PROGRAM_VERSION_DARWIN_SUBSYSTEM_LIMA
    };
    expect(descriptor).toMatchObject(expected);
  });

  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    await p1.setEngine(ENGINE_VIRTUALIZED);
    await p1.setOperatingSystemType("Windows_NT");
    await p1.setProgramPath(PROGRAM_PATH_WINDOWS_VIRTUALIZED);
    const descriptor = await p1.getDescriptor();
    const expected = {
      connection: "//./pipe/podman-machine-default",
      engine: ENGINE_VIRTUALIZED,
      name: "podman",
      path: PROGRAM_PATH_WINDOWS_VIRTUALIZED,
      version: PROGRAM_VERSION_WINDOWS_VIRTUALIZED
    };
    expect(descriptor).toMatchObject(expected);
  });
});

describe("getSystemConnections", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const items = await p1.getSystemConnections();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Default: true,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: machine,
        URI: "ssh://core@localhost:43861/run/user/1000/podman/podman.sock"
      },
      {
        Default: false,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: `${machine}-root`,
        URI: "ssh://root@localhost:43861/run/podman/podman.sock"
      }
    ]);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getSystemConnections();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([]);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getSystemConnections();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Default: true,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: machine,
        URI: "ssh://core@localhost:49872/run/user/501/podman/podman.sock"
      },
      {
        Default: false,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: `${machine}-root`,
        URI: "ssh://root@localhost:49872/run/podman/podman.sock"
      }
    ]);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const items = await p1.getSystemConnections();
    expect(items).toStrictEqual([]);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getSystemConnections();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Default: true,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: machine,
        URI: "ssh://user@localhost:53064/run/user/1000/podman/podman.sock"
      },
      {
        Default: false,
        Identity: path.join(process.env.HOME, ".ssh", machine),
        Name: `${machine}-root`,
        URI: "ssh://root@localhost:53064/run/podman/podman.sock"
      }
    ]);
  });
});

describe("getSystemInfo", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const info = await p1.getSystemInfo();
    expect(info).toMatchObject({
      host: {
        arch: "amd64"
      },
      version: {
        APIVersion: "4.0.3"
      }
    });
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const info = await p1.getSystemInfo();
    expect(info).toMatchObject({
      host: {
        arch: "amd64"
      },
      version: {
        APIVersion: "4.0.2"
      }
    });
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const info = await p1.getSystemInfo();
    expect(info).toMatchObject({
      host: {
        arch: "amd64"
      },
      version: {
        APIVersion: "4.0.2"
      }
    });
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const info = await p1.getSystemInfo();
    expect(info).toMatchObject({
      host: {
        arch: "amd64"
      },
      version: {
        APIVersion: "3.2.1"
      }
    });
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const info = await p1.getSystemInfo();
    expect(info).toMatchObject({
      host: {
        arch: "amd64"
      },
      version: {
        APIVersion: "4.0.3"
      }
    });
  });
});

describe("getImages", () => {
  // TODO: Seed with images
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const items = await p1.getImages();
    expect(items).toStrictEqual([]);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getImages();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getImages();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const items = await p1.getImages();
    expect(items).toStrictEqual([]);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getImages();
    expect(items).toStrictEqual([]);
  });
});

describe("getVolumes", () => {
  // TODO: Seed with volumes
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const items = await p1.getVolumes();
    expect(items).toStrictEqual([]);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getVolumes();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getVolumes();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const items = await p1.getVolumes();
    expect(items).toStrictEqual([]);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getVolumes();
    expect(items).toStrictEqual([]);
  });
});

describe("getContainers", () => {
  // TODO: Seed with containers
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const items = await p1.getContainers();
    expect(items).toStrictEqual([]);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getContainers();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getContainers();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const items = await p1.getContainers();
    expect(items).toStrictEqual([]);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getContainers();
    expect(items).toStrictEqual([]);
  });
});

describe("getMachines", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const items = await p1.getMachines();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Active: true,
        CPUs: Number.NaN,
        // Created: "true",
        DiskSize: "2.147GB",
        // LastUp: "4 days ago",
        Memory: "1",
        Name: machine,
        Running: false,
        VMType: "qemu"
      }
    ]);
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getMachines();
    expect(items).toStrictEqual([]);
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getMachines();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Active: true,
        CPUs: Number.NaN,
        Created: "true",
        // DiskSize: "2.147GB",
        // LastUp: "9 days ago",
        Memory: "1",
        Name: machine,
        Running: false,
        VMType: "qemu"
      }
    ]);
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const items = await p1.getMachines();
    expect(items).toStrictEqual([]);
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const items = await p1.getMachines();
    const machine = await p1.getVirtualizationMachineName();
    expect(items).toMatchObject([
      {
        Name: machine,
        Active: true,
        Running: false,
        VMType: "wsl",
        Created: "true", // But it is running ?
        // LastUp: '5 days ago',
        CPUs: Number.NaN
        // Memory: "8"
        // DiskSize: "1.281GB"
      }
    ]);
  });
});

describe("pruneSystem", () => {
  const timeout = 15000;
  testOnLinux(
    "linux.native",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_NATIVE);
      const report = await p1.pruneSystem();
      expect(report).toMatchObject({
        ContainerPruneReports: null,
        ImagePruneReports: null,
        PodPruneReport: null,
        ReclaimedSpace: -1,
        VolumePruneReports: null
      });
    },
    timeout
  );
  testOnLinux(
    "linux.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const report = await p1.pruneSystem();
      expect(report).toMatchObject({
        ContainerPruneReports: null,
        ImagePruneReports: null,
        PodPruneReport: null,
        ReclaimedSpace: -1,
        VolumePruneReports: null
      });
    },
    timeout
  );
  testOnDarwin(
    "darwin.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const report = await p1.pruneSystem();
      expect(report).toMatchObject({
        ContainerPruneReports: null,
        ImagePruneReports: null,
        PodPruneReport: null,
        ReclaimedSpace: -1,
        VolumePruneReports: null
      });
    },
    timeout
  );
  testOnDarwin(
    "darwin.subsystem.lima",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
      const report = await p1.pruneSystem();
      expect(report).toMatchObject({
        ContainerPruneReports: null,
        ImagePruneReports: null,
        PodPruneReport: null,
        ReclaimedSpace: -1,
        VolumePruneReports: null
      });
    },
    timeout
  );
  testOnWindows(
    "windows.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const report = await p1.pruneSystem();
      expect(report).toMatchObject({
        ContainerPruneReports: null,
        ImagePruneReports: null,
        PodPruneReport: null,
        ReclaimedSpace: -1,
        VolumePruneReports: null
      });
    },
    timeout
  );
});

describe("resetSystem", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    const machine = await p1.getVirtualizationMachineName();
    p1.setEngine(ENGINE_NATIVE);
    const report = await p1.resetSystem();
    expect(report).toMatchObject({
      containers: [],
      images: [],
      machines: [
        {
          Active: true,
          CPUs: Number.NaN,
          // Created: "true",
          // DiskSize: "2.147GB",
          // LastUp: "5 days ago",
          Memory: "1",
          Name: machine,
          Running: false,
          VMType: "qemu"
        }
      ],
      volumes: []
    });
  });
  testOnLinux("linux.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const report = await p1.resetSystem();
    expect(report).toMatchObject({
      containers: [],
      images: [],
      machines: [],
      volumes: []
    });
  });
  testOnDarwin("darwin.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const machine = await p1.getVirtualizationMachineName();
    const report = await p1.resetSystem();
    expect(report).toMatchObject({
      containers: [],
      images: [],
      machines: [
        {
          Active: true,
          CPUs: Number.NaN,
          Created: "true",
          // DiskSize: "2.147GB",
          // LastUp: "9 days ago",
          Memory: "1",
          Name: machine,
          Running: false,
          VMType: "qemu"
        }
      ],
      volumes: []
    });
  });
  testOnDarwin("darwin.subsystem.lima", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    const report = await p1.resetSystem();
    expect(report).toMatchObject({
      containers: [],
      images: [],
      machines: [],
      volumes: []
    });
  });
  testOnWindows("windows.virtualized", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_VIRTUALIZED);
    const machine = await p1.getVirtualizationMachineName();
    const report = await p1.resetSystem();
    expect(report).toMatchObject({
      containers: [],
      images: [],
      machines: [
        {
          Name: machine,
          Active: true,
          Running: false,
          VMType: "wsl",
          Created: "true", // But it is running ?
          // LastUp: "5 days ago",
          CPUs: Number.NaN
          // Memory: "8"
          // DiskSize: "1.288GB"
        }
      ],
      volumes: []
    });
  });
});

describe("getApiConfig", () => {
  const timeout = 15000;
  testOnLinux(
    "linux.native",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_NATIVE);
      const config = await p1.getApiConfig();
      expect(config).toStrictEqual({
        timeout: 60000,
        socketPath: await p1.getApiSocketPath(),
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      });
    },
    timeout
  );
  testOnLinux(
    "linux.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const config = await p1.getApiConfig();
      expect(config).toStrictEqual({
        timeout: 60000,
        socketPath: await p1.getApiSocketPath(),
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      });
    },
    timeout
  );
  testOnDarwin(
    "darwin.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const config = await p1.getApiConfig();
      expect(config).toStrictEqual({
        timeout: 60000,
        socketPath: await p1.getApiSocketPath(),
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      });
    },
    timeout
  );
  testOnDarwin(
    "darwin.subsystem.lima",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
      const config = await p1.getApiConfig();
      expect(config).toStrictEqual({
        timeout: 60000,
        socketPath: await p1.getApiSocketPath(),
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      });
    },
    timeout
  );
  testOnWindows(
    "windows.virtualized",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const config = await p1.getApiConfig();
      expect(config).toStrictEqual({
        timeout: 60000,
        socketPath: await p1.getApiSocketPath(),
        baseURL: "http://d/v3.0.0/libpod",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        }
      });
    },
    timeout
  );
});

describe("startApi", () => {
  let p1;
  beforeEach(() => {
    p1 = new Backend();
    p1.engineStarterMap = {
      [ENGINE_NATIVE]: jest.fn().mockName("startApiNative"),
      [ENGINE_REMOTE]: jest.fn().mockName("startApiRemote"),
      [ENGINE_VIRTUALIZED]: jest.fn().mockName("startApiVirtualized"),
      [ENGINE_SUBSYSTEM_LIMA]: jest.fn().mockName("startApiSubsystemLIMA"),
      [ENGINE_SUBSYSTEM_WSL]: jest.fn().mockName("startApiSubsystemWSL")
    };
  });
  test("linux.native", async () => {
    p1.setEngine(ENGINE_NATIVE);
    p1.setOperatingSystemType("Linux");
    await p1.startApi();
    expect(p1.engineStarterMap[ENGINE_NATIVE]).toHaveBeenCalled();
  });
  test("linux.virtualized", async () => {
    p1.setEngine(ENGINE_VIRTUALIZED);
    p1.setOperatingSystemType("Linux");
    await p1.startApi();
    expect(p1.engineStarterMap[ENGINE_VIRTUALIZED]).toHaveBeenCalled();
  });
  test("darwin.virtualized", async () => {
    p1.setEngine(ENGINE_VIRTUALIZED);
    p1.setOperatingSystemType("Darwin");
    await p1.startApi();
    expect(p1.engineStarterMap[ENGINE_VIRTUALIZED]).toHaveBeenCalled();
  });
  test("darwin.subsystem.lima", async () => {
    p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
    p1.setOperatingSystemType("Darwin");
    await p1.startApi();
    expect(p1.engineStarterMap[ENGINE_SUBSYSTEM_LIMA]).toHaveBeenCalled();
  });
  test("windows.virtualized", async () => {
    p1.setEngine(ENGINE_VIRTUALIZED);
    p1.setOperatingSystemType("Windows_NT");
    await p1.startApi();
    expect(p1.engineStarterMap[ENGINE_VIRTUALIZED]).toHaveBeenCalled();
  });
});

describe("getIsApiRunning", () => {
  testOnLinux("linux.native", async () => {
    const p1 = new Backend();
    p1.setEngine(ENGINE_NATIVE);
    const result = await p1.getIsApiRunning();
    expect(result).toBe(false);
  });
});

describe("startApiNative", () => {
  testOnLinux(
    "linux.native",
    async () => {
      const p1 = new Backend();
      p1.setEngine(ENGINE_NATIVE);
      const success = await p1.startApiNative();
      expect(success).toBe(true);
      const proc = { code: null, stderr: "", stdout: "", success: true };
      expect(p1.nativeApiStarterProcess).toMatchObject(proc);
      process.kill(p1.nativeApiStarterProcess.pid, "SIGTERM");
    },
    15000
  );
  testOnLinux(
    "linux.virtualized",
    async () => {
      await exec_launcher("podman", ["machine", "stop", PODMAN_MACHINE_DEFAULT]);
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const success = await p1.startApiVirtualized();
      expect(success).toBe(true);
      const machine = await p1.getVirtualizationMachineInfo();
      expect(machine).toMatchObject({
        Name: await p1.getVirtualizationMachineName(),
        RemoteUsername: "core",
        Running: true,
        Stream: "testing",
        VMType: "qemu"
      });
    },
    15000
  );
  testOnDarwin(
    "darwin.virtualized",
    async () => {
      await exec_launcher("podman", ["machine", "stop", PODMAN_MACHINE_DEFAULT]);
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const success = await p1.startApiVirtualized();
      expect(success).toBe(true);
      const machine = await p1.getVirtualizationMachineInfo();
      expect(machine).toMatchObject({
        Name: await p1.getVirtualizationMachineName(),
        RemoteUsername: "core",
        Running: true,
        Stream: "testing",
        VMType: "qemu"
      });
    },
    30000
  );
  testOnDarwin(
    "darwin.subsystem.lima",
    async () => {
      await exec_launcher("limactl", ["stop", "podman"]);
      const p1 = new Backend();
      p1.setEngine(ENGINE_SUBSYSTEM_LIMA);
      const success = await p1.startApiVirtualized();
      expect(success).toBe(true);
      const machine = await p1.getVirtualizationMachineInfo();
      expect(machine).toMatchObject({
        Name: await p1.getVirtualizationMachineName(),
        RemoteUsername: "core",
        Running: true,
        Stream: "testing",
        VMType: "qemu"
      });
    },
    30000
  );
  testOnWindows(
    "windows.virtualized",
    async () => {
      await exec_launcher("podman", ["machine", "stop", PODMAN_MACHINE_DEFAULT]);
      const p1 = new Backend();
      p1.setEngine(ENGINE_VIRTUALIZED);
      const success = await p1.startApiVirtualized();
      expect(success).toBe(true);
      const machine = await p1.getVirtualizationMachineInfo();
      expect(machine).toMatchObject({
        Name: await p1.getVirtualizationMachineName(),
        RemoteUsername: "",
        Running: true,
        Stream: "35",
        VMType: "wsl"
      });
    },
    30000
  );
});
