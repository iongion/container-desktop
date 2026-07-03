# Container Desktop

Podman Desktop Companion

![GitHub Release](https://img.shields.io/github/v/release/iongion/container-desktop)
![GitHub repo size](https://img.shields.io/github/repo-size/iongion/container-desktop)
![Github All Releases](https://img.shields.io/github/downloads/iongion/container-desktop/total.svg)

## Documentation

Full project documentation lives in [`docs/`](docs/):

- **[Architecture](docs/README.md)**
  - [Overview](docs/architecture/overview.md)
  - [Backend](docs/architecture/backend.md)
  - [Frontend](docs/architecture/frontend.md)
  - [AI subsystem](docs/architecture/ai-subsystem.md)
  - [Connection startup](docs/architecture/connection-startup.md)
  - [Engine matrix](docs/architecture/engine-matrix.md)
  - [Notes / principles](docs/architecture/notes.md)
- **Guides**
  - [Development](docs/development.md)
  - [Testing](docs/testing.md)
  - [Usage](docs/usage.md)
  - [LIMA setup](docs/lima.md)
- **Project**
  - [TODO / roadmap](docs/todo.md)
  - [Changelog](CHANGELOG.md)

## Author notes

- No telemetry
- Identical UI on all platforms
- Dynamic engine based theme

## Requirements

- **Linux** - Install [podman](https://podman.io/docs/installation) - note that distributions usually have older versions of podman, see [Aalvistack](https://software.opensuse.org/download/package?package=podman&project=home%3Aalvistack) for the most recent repositories.
Additional packages besides podman may be required, such as `aardvark-dns` and `passt` for networking (<https://passt.top/passt/about/>).
If one wants to add support for docker container engine, the easiest is to install rootless docker as documented here <https://linuxhandbook.com/rootless-docker/>
- **Windows** - Install [podman](https://podman.io/docs/installation) or provision your favorite WSL distribution with latest podman by following the instructions above for **Linux**. On your custom WSL distribution, the engine's own `system dial-stdio` bridges its unix socket back to the Windows native context (named pipe ↔ `wsl.exe` stdio — no TCP listener or SSH server inside the distribution).
- **MacOS** - Install [podman](https://podman.io/docs/installation) or [lima](https://lima-vm.io/)

## Usage

- See [docs/usage.md](docs/usage.md)

## Familiar interface

![Container Desktop Dashboard](website-src/static/img/unified/001-Dashboard.png?raw=true)

## Containers management

![Container Actions](website-src/static/img/unified/003-ContainerActions.png?raw=true)

## Image building

![Image Actions](website-src/static/img/unified/Build.png?raw=true)

## AI assistant

![AI assistant](website-src/static/img/unified/AIAssistant.png?raw=true)

## Podman is the driving engine

![Container Desktop Dashboard](website-src/static/img/podman/Pods.png?raw=true)

## Multiple engines and remote connections supported

![Docker engine Connections](website-src/static/img/docker/ConnectionManager.png?raw=true)
