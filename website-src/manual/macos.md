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
  - { id: macos-apple-container, label: "5 · Container" }
  - { id: macos-share, label: "6 · Sharing connection" }
---

<section class="guide-sec" id="macos-req">

### Requirements

<div class="note req">

On macOS, virtualization (via Lima or colima) is required for the Podman and Docker engines — they run inside a Linux VM. Apple&trade; Container is a third option: a native Apple-silicon runtime that needs no VM (experimental; see section 5 below). Homebrew is seriously recommended to simplify provisioning and setup. Due to high cost, Container Desktop does not currently afford an Apple subscription to digitally sign applications, nor a digital certificate.

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
colima start --vm-type=vz --vz-rosetta --disk-image ~/Downloads/ubuntu-26.04-minimal-cloudimg-arm64-docker.qcow2
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

<div class="note tip">

If the `docker` command is **not found** after the install, Homebrew placed the formula in its Cellar without creating the `docker` symlink (it was left **unlinked**, so it is missing from your shell entirely — not a `PATH` problem). Link it explicitly:

</div>

```bash
brew link docker
docker --version   # confirms the CLI is now available
```

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

<section class="guide-sec" id="macos-apple-container">

### <span class="n">05</span> Container <span class="exp-label">Experimental</span>

<div class="note info">

Apple's [`container`](https://github.com/apple/container) engine is a native macOS container runtime for Apple silicon. Container Desktop support is experimental: the app targets the Docker-compatible API exposed by [`socktainer`](https://github.com/socktainer/socktainer), not Apple's private XPC service directly.

</div>

#### Requirements

- Apple silicon Mac.
- macOS 26 Tahoe recommended. macOS 15 can run Apple `container`, but networking is degraded and some network commands are unavailable.
- Apple's `container` CLI installed from the [official GitHub releases](https://github.com/apple/container/releases).
- A compatible `socktainer` installation to expose a Docker Engine API socket.

#### Install Apple&trade; Container

Download the signed installer package from the [Apple container releases](https://github.com/apple/container/releases), verify it, install it, then start the system service. The example below pins Apple&trade; Container `1.0.0`; if you choose a newer release, use that release's package name and checksum instead.

```bash
mkdir -p ~/Downloads/container-desktop-provision
cd ~/Downloads/container-desktop-provision

curl -L -o container-1.0.0-installer-signed.pkg \
  https://github.com/apple/container/releases/download/1.0.0/container-1.0.0-installer-signed.pkg

shasum -a 256 container-1.0.0-installer-signed.pkg
# expect: 13f45f26da94c354adcbefe1e8f7631e7f126e93c5d4dd6a5a538aa66b4f479d

sudo installer -pkg container-1.0.0-installer-signed.pkg -target /

container system start
```

#### Install socktainer

Install the Docker-compatible API bridge:

```bash
brew tap socktainer/tap
brew install socktainer
```

Start `socktainer` in the background and confirm that it exposes the Docker-compatible Unix socket:

```bash
mkdir -p ~/.socktainer
nohup socktainer > ~/.socktainer/socktainer.log 2>&1 &

sleep 2
test -S "$HOME/.socktainer/container.sock" && echo "socktainer socket OK"
```

Verify the socket with the Docker Engine API endpoints Container Desktop uses:

```bash
curl --unix-socket "$HOME/.socktainer/container.sock" http://localhost/_ping
curl --unix-socket "$HOME/.socktainer/container.sock" http://localhost/version
```

Homebrew also prints a service-mode option after installing `socktainer`. In that mode, `socktainer` runs with a Homebrew-owned `HOME`, so the socket is not under your user home. Use this if you want `socktainer` to start at login:

```bash
brew services start socktainer

SOCKTAINER_HOME="$(brew --prefix)/var/run/socktainer"
export DOCKER_HOST="unix://$SOCKTAINER_HOME/.socktainer/container.sock"

curl --unix-socket "$SOCKTAINER_HOME/.socktainer/container.sock" http://localhost/_ping
```

Or run the same service-style command manually without registering a login service:

```bash
SOCKTAINER_HOME="$(brew --prefix)/var/run/socktainer"
HOME="$SOCKTAINER_HOME" "$(brew --prefix)/opt/socktainer/bin/socktainer"
```

If you use Homebrew service mode with a remote Mac connection, configure Container Desktop to use the service socket path explicitly: `$(brew --prefix)/var/run/socktainer/.socktainer/container.sock`. For development env-seeded connections, that is `CONTAINER_DESKTOP_REMOTE_<ID>_APPLE_SOCKET`, for example:

```bash
CONTAINER_DESKTOP_REMOTE_MAC_APPLE_SOCKET=/opt/homebrew/var/run/socktainer/.socktainer/container.sock
```

Socktainer can also register a Docker context named `socktainer`, so the official Docker CLI can use Apple containers without changing Container Desktop's resource model.

#### Remote Mac over SSH

Because `socktainer` exposes a Unix socket, it can be forwarded over SSH in the same style as remote Docker or Podman sockets. With the per-user launch above, Container Desktop auto-detects `$HOME/.socktainer/container.sock`. With Homebrew service mode, use the explicit service socket path from the previous section. The remote host still has to be an Apple silicon Mac with Apple `container` and `socktainer` running; the client machine only needs SSH access to that Mac.

</section>

<section class="guide-sec" id="macos-share">

### <span class="n">06</span> Sharing connection with Container Desktop

The `DOCKER_HOST` environment variable must be set to the same value Container Desktop is using when connected. The exact value is under **Connection info** in the **Settings** section.

</section>
