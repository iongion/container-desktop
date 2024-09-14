# Container Desktop

Podman Desktop Companion

![GitHub Release](https://img.shields.io/github/v/release/iongion/container-desktop)
![GitHub repo size](https://img.shields.io/github/repo-size/iongion/container-desktop)
![Github All Releases](https://img.shields.io/github/downloads/iongion/container-desktop/total.svg)

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
- **Windows** - Install [podman](https://podman.io/docs/installation) or provision your favorite WSL distribution with latest podman by following the instructions above for **Linux**. On your custom WSL distribution, `netcat` or `socat` are needed to relay unix sockets back to Windows native context. Example `sudo apt install netcat` for Ubuntu.
- **MacOS** - Install [podman](https://podman.io/docs/installation) or [lima](https://lima-vm.io/)

> NOTE - To access and monitor remote ssh installations, properly set-up the connections in your `$HOME/.ssh/config` or `$env:USERPROFILE/.ssh/config` just like you do for Visual Studio Code remote extensions <https://code.visualstudio.com/docs/remote/ssh> - SSH connections are tunneled through a **tcp** listener, listening to `localhost` only.

## Usage

- See [USAGE.md](./USAGE.md)

## Podman is the driving engine

![Container Desktop Dashboard](docs/img/001-Dashboard.png?raw=true)

## Multiple engines supported, familiar ones too

![Connection Manager](docs/img/ConnectionManager.png?raw=true)

## Comprehensive actions

![Container Actions](docs/img/003-ContainerActions.png?raw=true)

![Image Actions](docs/img/006-ImageActions.png?raw=true)
