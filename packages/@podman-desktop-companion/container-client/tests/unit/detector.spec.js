// node
const path = require("path");
// project
// modules
const {
  findProgramPath,
  findProgramVersion,
  detectWSLDistributions,
  detectLIMAInstances
} = require("../../src/detector");
// locals
const {
  testOnLinux,
  testOnWindows,
  testOnMacOS,
  ensurePodmanMachineIsRunning,
  ensureLIMAInstanceIsRunning
} = require("../helpers");

jest.setTimeout(120000);

// beforeAll(async () => {
//   await ensurePodmanMachineIsRunning();
//   await ensureLIMAInstanceIsRunning();
// });

describe("detector", () => {
  // findProgramPath
  testOnLinux("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe("/usr/bin/podman");
  });
  testOnWindows("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe("C:\\Program Files\\RedHat\\Podman\\podman.exe");
  });
  testOnMacOS("findProgramPath", async () => {
    const path = await findProgramPath("podman");
    expect(path).toBe("/usr/local/bin/podman");
  });
  testOnLinux("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe("/usr/bin/podman");
  });
  testOnWindows("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe("/usr/bin/podman");
  });
  testOnMacOS("findProgramPath - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramPath("podman", { wrapper });
    expect(path).toBe("/usr/bin/podman");
  });
  // findProgramVersion
  testOnLinux("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe("4.0.3");
  });
  testOnWindows("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe("4.0.3-dev");
  });
  testOnMacOS("findProgramVersion", async () => {
    const path = await findProgramVersion("podman");
    expect(path).toBe("4.0.3");
  });
  testOnLinux("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe("4.0.3");
  });
  testOnWindows("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe("4.0.3");
  });
  testOnMacOS("findProgramVersion - with wrapper", async () => {
    const wrapper = {
      launcher: "podman",
      args: ["machine", "ssh", "podman-machine-default"]
    };
    const path = await findProgramVersion("podman", { wrapper });
    expect(path).toBe("4.0.2");
  });
  // detectWSLDistributions
  testOnLinux("detectWSLDistributions", async () => {
    const path = await detectWSLDistributions();
    expect(path).toEqual([]);
  });
  testOnWindows("detectWSLDistributions", async () => {
    const path = await detectWSLDistributions();
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
        Name: "podman-machine-default",
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
  testOnMacOS("detectWSLDistributions", async () => {
    const path = await detectWSLDistributions();
    expect(path).toEqual([]);
  });
  // detectLIMAInstances
  testOnLinux("detectLIMAInstances", async () => {
    const path = await detectLIMAInstances();
    expect(path).toEqual([]);
  });
  testOnWindows("detectLIMAInstances", async () => {
    const path = await detectLIMAInstances();
    expect(path).toEqual([]);
  });
  testOnMacOS("detectLIMAInstances", async () => {
    const items = await detectLIMAInstances();
    expect(items).toMatchObject([
      {
        Arch: "x86_64",
        CPUs: "4",
        Dir: path.join(process.env.HOME, ".lima/docker"),
        Disk: "100GiB",
        Memory: "4GiB",
        Name: "docker",
        // SSH: "127.0.0.1:50167",
        Status: "Running"
      },
      {
        Arch: "x86_64",
        CPUs: "4",
        Dir: path.join(process.env.HOME, ".lima/podman"),
        Disk: "100GiB",
        Memory: "4GiB",
        Name: "podman",
        // SSH: "127.0.0.1:50139",
        Status: "Running"
      }
    ]);
  });
});
