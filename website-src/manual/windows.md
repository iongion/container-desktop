---
os: windows
osLabel: Windows
osIcon: fa-windows
order: 3
permalink: false
sections:
  - { id: windows-req, label: "Requirements" }
  - { id: windows-quick, label: "1 · Quick guide" }
  - { id: windows-best, label: "2 · Best experience" }
  - { id: windows-podman-docker, label: "3 · Podman as Docker" }
  - { id: windows-dd-alt, label: "4 · Docker Desktop alternative" }
  - { id: windows-podman-custom, label: "5 · Podman custom install" }
  - { id: windows-share, label: "6 · Sharing connection" }
  - { id: windows-tips, label: "7 · Tips & tricks" }
---

<section class="guide-sec" id="windows-req">

### Requirements

<div class="note req">

On Windows, virtualization is required to support both podman and docker container engines. With WSL, the development experience has evolved — it is highly recommended to move away from msys/cygwin and just use WSL. Most of the time we deploy on Linux anyway, so an experience closer to reality is appropriate. It is also a good opportunity to learn Linux.

</div>

#### As a non-administrator user

```powershell
winget install -e --id=Microsoft.WindowsTerminal
winget install "Container Desktop"
```

#### Enable and install WSL (as administrator)

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
winget install -e --id=Microsoft.WSL
```

<div class="note info">

Restart the computer, then set up the WSL distribution user account by starting `wsl.exe` in a Windows Terminal.

</div>

</section>

<section class="guide-sec" id="windows-quick">

### <span class="n">01</span> Quick guide

#### Enable and install WSL (as administrator)

```powershell
winget install -e --id=Microsoft.WSL
```

- This installs the default Ubuntu distribution, fine for most users (Ubuntu-24.04 is the latest at the time of writing).
- It also installs a profile inside Windows Terminal, a great terminal emulator for Windows.
- After setting up your Linux user, follow the [Linux installation guide](#linux-quick) to install docker and/or podman.

#### If WSL is already installed, update it and set version 2

```powershell
wsl --update
wsl --set-default-version 2
```

#### As a non-administrator user

```powershell
winget install -e --id=Microsoft.WindowsTerminal
winget install -e --id=Docker.DockerCLI
winget install -e --id=RedHat.Podman
winget install "Container Desktop"
```

#### Open Container Desktop

Create an automatic connection to your WSL distribution using either docker or podman engines. Choose your preferred one, make it default, and click **Connect**.

</section>

<section class="guide-sec" id="windows-best">

### <span class="n">02</span> Podman and Docker — best experience

#### Requirements

Ensure all requirements are installed as per the [requirements](#windows-req).

#### Custom WSL

Inside the WSL distribution, follow the [Linux installation guide](#linux-quick) to install both podman and docker container engines.

#### Best developer experience

Perform all container operations inside the WSL distribution directly — it is just Linux in the end. WSL is the best way to run Linux on Windows.

</section>

<section class="guide-sec" id="windows-podman-docker">

### <span class="n">03</span> Podman acting as Docker

<div class="note info">

This is referred to as **Compatibility Mode** — it should support all docker features, except the docker cli (use podman instead; alias it if you want).

</div>

#### Latest and greatest

Go to the [Podman releases page](https://github.com/containers/podman/releases) and get the latest Windows installer. Consider:

- Upon installation, podman creates its own WSL distribution, also known as Podman Machine.
- It also sets the `DOCKER_HOST` environment variable to point at the podman named pipe.

#### Easiest (skip if using latest and greatest)

```powershell
winget install -e --id=RedHat.Podman
```

</section>

<section class="guide-sec" id="windows-dd-alt">

### <span class="n">04</span> Docker Desktop alternative

#### Requirements

Ensure all requirements are installed as per the [requirements](#windows-req).

#### Add docker engine support

Inside the WSL distribution, follow the [Linux installation guide](#linux-quick) to install the docker container engine.

#### Adding support for the native `docker.exe` binary

```powershell
winget install -e --id=Docker.DockerCLI
```

A restart of your terminal is recommended after installing the CLI tools. Latest `docker.exe` binaries can also be found at:

- **Intel CPUs** — [download.docker.com/win/static/stable/x86_64](https://download.docker.com/win/static/stable/x86_64/)

</section>

<section class="guide-sec" id="windows-podman-custom">

### <span class="n">05</span> Podman — custom installation

#### Podman engine setup inside WSL

Inside the WSL distribution, follow the [Linux installation guide](#linux-quick) to install the podman container engine.

#### Container Desktop

Open Container Desktop and create a new Podman engine connection using the WSL host, selecting your distribution of choice.

</section>

<section class="guide-sec" id="windows-share">

### <span class="n">06</span> Sharing connection with Container Desktop

The `DOCKER_HOST` environment variable must be set to the same value Container Desktop is using when connected. The exact value is under **Connection info** in the **Settings** section.

</section>

<section class="guide-sec" id="windows-tips">

### <span class="n">07</span> Tips &amp; tricks

#### Ensure WSL 2 and cgroups v2

To ensure WSL version 2 is set: `wsl --set-default-version 2`. For the recommended cgroups v2, modify or create the `.wslconfig` file in `%USERPROFILE%` with:

```ini
[wsl2]
# ...
kernelCommandLine = ipv6.disable=1 cgroup_no_v1=all
```

<div class="note info">

After modifying/creating, stop the WSL engine with `wsl.exe --shutdown` and restart with `wsl.exe`.

</div>

#### Good to know

Although possible, **it is not required** to install the Container Desktop application inside WSL.

</section>
