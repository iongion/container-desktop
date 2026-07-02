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

## **IMPORTANT**

- [Podman](https://podman.io/) offers an official cross-platform desktop UI available at [Podman Desktop](https://podman-desktop.io/), give it a try.
- The container UI space is much more rich today, minimalist solutions exist, such as [Pods](https://github.com/marhkb/pods), [Podman TUI](https://github.com/containers/podman-tui) or feature rich ones such as [Rancher Desktop](https://rancherdesktop.io/)

## Author notes

- Podman **Desktop Companion** is considered **complete**, it started by offering a familiar experience, but it strives to offer its own identity.
- _It will not be shut-down or archived unless required, it was **the first cross-platform container UI** before any other existing solution._
- _There is **great pride in this**(mom is proud), no other benefits were obtained, no donations on patreon or ko-fi since inception._
- _It was my first experience with the open source world as a creator and the one that made me **never do it again**, at least not on my own._
- _Thank you to **The Podman Team** and to all the great persons I've met!_

## Scope

A familiar desktop graphical interface to the free and open container manager, [podman!](https://podman.io/)

Main goals

- Cross-platform desktop integrated application with consistent UI
- Learning tool for the powerful `podman` command line interface

## Requirements

- **Linux** - Install [podman](https://podman.io/docs/installation) - note that distributions usually have older versions of podman, see [Aalvistack](https://software.opensuse.org/download/package?package=podman&project=home%3Aalvistack) for the most recent repositories.
Additional packages besides podman may be required, such as `aardvark-dns` and `passt` for networking (<https://passt.top/passt/about/>).
If one wants to add support for docker container engine, the easiest is to install rootless docker as documented here <https://linuxhandbook.com/rootless-docker/>
- **Windows** - Install [podman](https://podman.io/docs/installation) or provision your favorite WSL distribution with latest podman by following the instructions above for **Linux**. On your custom WSL distribution, the engine's own `system dial-stdio` bridges its unix socket back to the Windows native context (named pipe ↔ `wsl.exe` stdio — no TCP listener or SSH server inside the distribution).
- **MacOS** - Install [podman](https://podman.io/docs/installation) or [lima](https://lima-vm.io/)

> NOTE - To access and monitor remote ssh installations, properly set-up the connections in your `$HOME/.ssh/config` or `$env:USERPROFILE/.ssh/config` just like you do for Visual Studio Code remote extensions <https://code.visualstudio.com/docs/remote/ssh> - remote SSH connections use the native `ssh` client with host-key verification (`StrictHostKeyChecking=accept-new` against `known_hosts`) and forward the engine's unix socket to a local socket only.

## Usage

- See [docs/usage.md](docs/usage.md)

## Podman is the driving engine

![Container Desktop Dashboard](website-src/static/img/podman/001-Dashboard.png?raw=true)

## Multiple engines supported, familiar ones too

![Docker engine Connections](website-src/static/img/docker/ConnectionManager.png?raw=true)

## Comprehensive actions

![Container Actions](website-src/static/img/podman/003-ContainerActions.png?raw=true)

![Image Actions](website-src/static/img/podman/006-ImageActions.png?raw=true)

## AI assistant — drive your engines in plain language

A built-in, **local-first** AI assistant inspects and operates your containers for you: it calls typed tools and renders the results as rich cards, asks before anything that changes state, and runs on your model — LM Studio or llama.cpp locally, or OpenRouter / Anthropic / OpenAI and more in the cloud. See the [manual](https://container-desktop.com/manual/#assistant).

![AI assistant](website-src/static/img/podman/AIAssistant.png?raw=true)
