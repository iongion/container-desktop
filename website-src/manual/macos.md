---
os: macos
osLabel: macOS
osIcon: fa-apple
order: 2
permalink: false
sections:
  - { id: macos-req, label: "Requirements" }
  - { id: macos-quick, label: "1 · Quick guide" }
  - { id: macos-best, label: "2 · Best experience" }
  - { id: macos-podman-docker, label: "3 · Podman as Docker" }
  - { id: macos-dd-alt, label: "4 · Docker Desktop alternative" }
  - { id: macos-share, label: "5 · Sharing connection" }
---

<section class="guide-sec" id="macos-req">

### Requirements

<div class="note req">

On macOS, virtualization is required to support both docker and podman container engines. Homebrew is seriously recommended to simplify provisioning and setup. Due to high cost, Container Desktop does not currently afford an Apple subscription to digitally sign applications, nor a digital certificate.

</div>

#### Install [homebrew](https://brew.sh/) (as a non-administrator user)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew update
brew upgrade
```

</section>

<section class="guide-sec" id="macos-quick">

### <span class="n">01</span> Quick guide

#### Install [colima](https://github.com/abiosoft/colima)

```bash
brew install colima
```

#### Start the colima VM

```bash
colima start --vm-type=vz --vz-rosetta
```

This uses the native macOS virtualization framework, allowing even x86 container images to run and avoiding volume-mount file-system permission issues.

<div class="note info">

You can also use custom distribution images for the docker host OS — see the [colima-core releases](https://github.com/abiosoft/colima-core/releases). After downloading the image of choice:

</div>

```bash
colima start --vm-type=vz --vz-rosetta --disk-image ~/Downloads/ubuntu-24.04-minimal-cloudimg-arm64-docker.qcow2
```

#### Install [docker](https://formulae.brew.sh/formula/docker) CLI tools and plugins

```bash
brew install docker docker-compose docker-buildx
```

This does not install Docker Desktop — only the command line tools that will use the colima docker engine. For the docker cli to find the plugins, add the following to your `~/.docker/config.json`:

```json
"cliPluginsExtraDirs": [
  "$HOMEBREW_PREFIX/lib/docker/cli-plugins"
]
```

After all of the above you should have a completely compatible docker engine running on your Mac.

#### Allow the unsigned app to run (optional)

If you downloaded and installed Container Desktop for macOS, allow it to run despite the missing digital signature:

```bash
xattr -d com.apple.quarantine /Applications/Container\ Desktop.app
```

#### Open Container Desktop

Connect to the **System Docker** default connection and all should work.

</section>

<section class="guide-sec" id="macos-best">

### <span class="n">02</span> Podman and Docker — best experience

#### Install [lima](https://lima-vm.io/)

LIMA uses macOS native virtualization to provide Linux environments — it is like WSL, but for macOS.

```bash
brew install lima
```

#### Podman VM

```bash
limactl start podman   # start the podman VM
limactl shell podman   # login to the podman VM
```

#### Docker VM

```bash
limactl start docker   # start the docker VM
limactl shell docker   # login to the docker VM
```

</section>

<section class="guide-sec" id="macos-podman-docker">

### <span class="n">03</span> Podman acting as Docker

<div class="note info">

This is referred to as **Compatibility Mode** — it should support all docker features, except the docker cli (use podman instead; alias it if you want).

</div>

#### Latest and greatest

Go to the [Podman releases page](https://github.com/containers/podman/releases) and install the latest macOS pkg for your CPU. Consider:

- Upon installation, podman creates its own VM, also known as Podman Machine.
- It also sets the `DOCKER_HOST` environment variable to point at the podman unix socket, making it easy for the docker cli to use it.

#### Easiest (skip if using latest and greatest)

```bash
brew install podman
```

</section>

<section class="guide-sec" id="macos-dd-alt">

### <span class="n">04</span> Docker Desktop alternative

Using **colima** offers the easiest experience — just follow the [Quick guide](#macos-quick) to support docker in full compatibility.

#### (*) Optional: native docker CLI without homebrew

Not recommended due to complexity. Latest docker CLI and plugin binaries can be found at:

- **Apple CPUs** — [download.docker.com/mac/static/stable/aarch64](https://download.docker.com/mac/static/stable/aarch64/)
- Intel CPUs — [download.docker.com/mac/static/stable/x86_64](https://download.docker.com/mac/static/stable/x86_64/)

</section>

<section class="guide-sec" id="macos-share">

### <span class="n">05</span> Sharing connection with Container Desktop

The `DOCKER_HOST` environment variable must be set to the same value Container Desktop is using when connected. The exact value is under **Connection info** in the **Settings** section.

</section>
