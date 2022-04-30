// node
const path = require("path");

const PODMAN_MACHINE_DEFAULT = "podman-machine-default";
const PODMAN_CLI_VERSION = "4.0.3";
const DOCKER_CLI_VERSION = "20.10.14";
const PODMAN_API_BASE_URL = "http://d/v3.0.0/libpod";
const DOCKER_API_BASE_URL = "http://localhost";

// Native
const NATIVE_DOCKER_CLI_PATH = "/usr/bin/docker";
const NATIVE_PODMAN_CLI_PATH = "/usr/bin/podman";
const NATIVE_DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const NATIVE_PODMAN_SOCKET_PATH = "/tmp/podman-desktop-companion-podman-rest-api.sock";

// Windows
const WINDOWS_PODMAN_CLI_VERSION = "4.0.3-dev";
const WINDOWS_PODMAN_CLI_PATH = "C:\\Program Files\\RedHat\\Podman\\podman.exe";
const WINDOWS_DOCKER_CLI_VERSION = "20.10.14";
const WINDOWS_DOCKER_CLI_PATH = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const WINDOWS_PODMAN_NAMED_PIPE = "//./pipe/podman-machine-default";
const WINDOWS_DOCKER_NAMED_PIPE = "//./pipe/docker_engine";

// WSL
const WSL_DISTRIBUTION = "Ubuntu-20.04";
const WSL_PATH = "C:\\Windows\\System32\\wsl.exe";
const WSL_PODMAN_CLI_PATH = "/usr/bin/podman";
const WSL_PODMAN_CLI_VERSION = "3.4.2";
const WSL_DOCKER_CLI_PATH = "/usr/bin/docker";
const WSL_DOCKER_CLI_VERSION = "20.10.14";
const WSL_PODMAN_NAMED_PIPE = "//./pipe/podman-desktop-companion-podman-Ubuntu-20.04";
const WSL_DOCKER_NAMED_PIPE = "//./pipe/podman-desktop-companion-docker-Ubuntu-20.04";

const WSL_DISTRIBUTIONS = [
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
];

// LIMA
const LIMA_PATH = "/usr/local/bin/limactl";
const LIMA_DOCKER_CLI_PATH = "/usr/bin/docker";
const LIMA_DOCKER_CLI_VERSION = "";
const LIMA_PODMAN_CLI_PATH = "/usr/bin/podman";
const LIMA_PODMAN_CLI_VERSION = "3.2.1";
const LIMA_PODMAN_INSTANCE = "podman";
const LIMA_DOCKER_INSTANCE = "docker";
const LIMA_PODMAN_SOCKET_PATH = path.join(process.env.HOME, ".lima", LIMA_PODMAN_INSTANCE, "sock/podman.sock");
const LIMA_DOCKER_SOCKET_PATH = path.join(process.env.HOME, ".lima", LIMA_DOCKER_INSTANCE, "sock/docker.sock");
const LIMA_INSTANCES = [
  {
    Arch: "x86_64",
    CPUs: "4",
    Dir: path.join(process.env.HOME, ".lima", LIMA_DOCKER_INSTANCE),
    Disk: "100GiB",
    Memory: "4GiB",
    Name: LIMA_DOCKER_INSTANCE,
    // SSH: "127.0.0.1:50167",
    Status: "Running"
  },
  {
    Arch: "x86_64",
    CPUs: "4",
    Dir: path.join(process.env.HOME, ".lima", LIMA_PODMAN_INSTANCE),
    Disk: "100GiB",
    Memory: "4GiB",
    Name: LIMA_PODMAN_INSTANCE,
    // SSH: "127.0.0.1:50139",
    Status: "Running"
  }
];

module.exports = {
  PODMAN_MACHINE_DEFAULT,
  PODMAN_CLI_VERSION,
  PODMAN_API_BASE_URL,
  DOCKER_CLI_VERSION,
  DOCKER_API_BASE_URL,
  // Native - Linux
  NATIVE_DOCKER_CLI_PATH,
  NATIVE_PODMAN_CLI_PATH,
  NATIVE_DOCKER_SOCKET_PATH,
  NATIVE_PODMAN_SOCKET_PATH,
  // Virtualized - Windows
  WINDOWS_PODMAN_CLI_VERSION,
  WINDOWS_PODMAN_CLI_PATH,
  WINDOWS_DOCKER_CLI_VERSION,
  WINDOWS_DOCKER_CLI_PATH,
  WINDOWS_PODMAN_NAMED_PIPE,
  WINDOWS_DOCKER_NAMED_PIPE,
  // WSL - Windows
  WSL_PATH,
  WSL_DOCKER_CLI_PATH,
  WSL_DOCKER_CLI_VERSION,
  WSL_PODMAN_CLI_PATH,
  WSL_PODMAN_CLI_VERSION,
  WSL_PODMAN_NAMED_PIPE,
  WSL_DOCKER_NAMED_PIPE,
  WSL_DISTRIBUTION, // Default WSL distribution (Ubuntu-20.04)
  WSL_DISTRIBUTIONS,
  // LIMA - MacOS
  LIMA_PATH,
  LIMA_DOCKER_CLI_PATH,
  LIMA_DOCKER_CLI_VERSION,
  LIMA_PODMAN_CLI_PATH,
  LIMA_PODMAN_CLI_VERSION,
  LIMA_DOCKER_INSTANCE,
  LIMA_PODMAN_INSTANCE,
  LIMA_DOCKER_SOCKET_PATH,
  LIMA_PODMAN_SOCKET_PATH,
  LIMA_INSTANCES
};
