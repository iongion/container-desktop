const path = require("path");

const PROGRAM = "docker";

const DOCKER_API_BASE_URL = "http://localhost";
const DOCKER_CLI_VERSION = "20.10.14";

const NATIVE_DOCKER_CLI_PATH = "/usr/bin/docker";
const NATIVE_DOCKER_SOCKET_PATH = "/var/run/docker.sock";

const WINDOWS_DOCKER_CLI_VERSION = "20.10.14";
const WINDOWS_DOCKER_CLI_PATH = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const WINDOWS_DOCKER_NAMED_PIPE = "//./pipe/docker_engine";

const MACOS_DOCKER_NATIVE_CLI_VERSION = "20.10.8";
const MACOS_DOCKER_NATIVE_CLI_PATH = "/usr/local/bin/docker";

const WSL_DOCKER_CLI_PATH = "/usr/bin/docker";
const WSL_DOCKER_CLI_VERSION = "20.10.14";
const WSL_DISTRIBUTION = "Ubuntu-20.04";

const LIMA_DOCKER_CLI_PATH = "/usr/bin/docker";
const LIMA_DOCKER_CLI_VERSION = "20.10.14";
const LIMA_DOCKER_INSTANCE = "docker";

module.exports = {
  PROGRAM,
  DOCKER_API_BASE_URL,
  DOCKER_CLI_VERSION,
  // Native only on Linux
  NATIVE_DOCKER_CLI_PATH,
  NATIVE_DOCKER_SOCKET_PATH,
  // Windows virtualized
  WINDOWS_DOCKER_CLI_VERSION,
  WINDOWS_DOCKER_CLI_PATH,
  WINDOWS_DOCKER_NAMED_PIPE,
  // MacOS virtualized
  MACOS_DOCKER_NATIVE_CLI_VERSION,
  MACOS_DOCKER_NATIVE_CLI_PATH,
  // Windows WSL
  WSL_DISTRIBUTION,
  WSL_DOCKER_CLI_PATH,
  WSL_DOCKER_CLI_VERSION,
  // MacOS LIMA
  LIMA_DOCKER_CLI_PATH,
  LIMA_DOCKER_CLI_VERSION,
  LIMA_DOCKER_INSTANCE,
  LIMA_DOCKER_SOCKET_PATH
};
