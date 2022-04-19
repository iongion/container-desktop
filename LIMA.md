# LIMA setup guide

See more about LIMA at project home page <https://github.com/lima-vm/lima>

## Requirements

* good terminal
* [homebrew](https://brew.sh/) - The Missing Package Manager for macOS (or Linux)

## Installation

Using a terminal of choice, execute the following commands:

1. Only once - `brew install lima` - This installs LIMA.
2. Only once - `limactl start /usr/local/share/doc/lima/examples/podman.yaml` - This is mandatory, it will provision an environment named `podman` with proper configuration for api access.
3. Any time - `limactl shell podman` - This is to drop a shell into the lima `podman` environment, you can then `uname -a` to see details of the subsystem.

> NOTE - After restart, one may need to execute `limactl start podman`
