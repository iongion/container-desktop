# App and API

## Local development

### Requirements

- nodejs & [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) to activate and manage multiple node versions
- python 3+ and a python version manager such as pyenv or conda
- bash friendly terminal

### TLDR

#### Prepare development environment

1. Install development tools for your OS

   - **Linux shortcut:** `bash support/provision-deps.sh` installs the build
     toolchain below (auto-detects apt/dnf/pacman). Linux ships a tar.gz, so no
     distro-specific packaging tooling is needed.
   - `sudo pacman -Sy base-devel` - Arch flavors
   - `sudo yum groupinstall "Development Tools" "Legacy Software Development"` - Fedora
   - `sudo apt-get install build-essential` - Debian / Ubuntu & friends
   - Get [homebrew](https://brew.sh/) - for MacOS
   - Native Windows - on your own, for WSL, use any of the Linux guides above!

2. Install [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) - for managing multiple node versions, this project uses version pinning, because OS package-manager provided nodejs is usually not proper for development.

   - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash`

   Don't forget to setup your shell environment as described by nvm.

3. Install the PM tool [invoke](https://www.pyinvoke.org/) - this is to support automation and fast REPL development environment.

   - `make prepare`

#### Prepare project infrastructure

`inv prepare` - Fetch all dependencies using

#### Live development with hot reloading

`inv start` - To start development servers

#### Build the project assets

`inv build` - Compiles assets

#### Bundle the project assets

`inv bundle` - Creates application bundles

#### Release the project binaries

`inv release` - Compiles assets and creates application bundles with production settings

### Other useful info

- Start API as socket (`socketPath` for axios)

  `podman system service --time=0 unix:///tmp/podman.sock --log-level=debug`

- Test socket api

  `curl --unix-socket /tmp/podman.sock http://d/v3.0.0/libpod/info`

- Start API as http server - HTTP api is only for development - insecure!

  `podman system service tcp:localhost:8081 --time=0 --log-level=debug --cors="*"`

- Test http api

  `curl -X GET http://localhost:8081/v3.0.0/libpod/info`

## Deployment

podman system connection add default "//wsl.localhost/Ubuntu-24.04/home/$USER/.ssh/id_rsa" --socket-path "\\wsl.localhost\Ubuntu-24.04\mnt\wslg\runtime-dir\podman\podman.sock"

## Get URI

> podman system connection ls

## Create tunnel

> ssh -nNT -L/tmp/podman.sock:/run/user/1000/podman/podman.sock -i ~/.ssh/podman-machine-default ssh://core@localhost:[PORT]

## Export socket location

> export DOCKER_HOST='/tmp/podman.sock'
