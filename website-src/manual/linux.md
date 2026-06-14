---
os: linux
osLabel: Linux
osIcon: fa-linux
order: 1
permalink: false
sections:
  - { id: linux-req, label: "Requirements" }
  - { id: linux-quick, label: "1 · Quick guide" }
  - { id: linux-podman-docker, label: "2 · Podman as Docker" }
  - { id: linux-dd-alt, label: "3 · Docker Desktop alternative" }
  - { id: linux-share, label: "4 · Sharing connection" }
---

<section class="guide-sec" id="linux-req">

### Requirements

<div class="note req">

**Linux offers the best experience** and fastest speed when working with containers. Besides avoiding the need for virtualization, when we develop we usually target Linux for production. File-system speed and permissions don't fit well when not using something made for Linux. **Although there is love for all operating systems, Linux is really shining here.**

</div>

Examples follow the Ubuntu distribution but can easily be adapted to any distribution.

</section>

<section class="guide-sec" id="linux-quick">

### <span class="n">01</span> Quick guide

#### Update your system

```bash
sudo apt-get update -y && sudo apt-get upgrade -y
```

#### Install development tools

```bash
sudo apt-get install -y build-essential
sudo apt install apt-transport-https ca-certificates curl software-properties-common -y
```

#### Install the docker container engine — this does NOT install Docker Desktop

```bash
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ${USER}   # restart your terminal after adding your user to the docker group
sudo systemctl enable docker      # start docker on boot
sudo systemctl restart docker     # start docker now
sudo systemctl is-active docker   # check docker is running
docker run hello-world            # test — docker cli must run without sudo at this point
```

#### Install the podman container engine and podman-compose

```bash
sudo apt-get install -y podman podman-compose
```

<div class="note tip">

Distributions usually ship very old podman versions. For more recent versions use the [Alvistack project](https://software.opensuse.org/download/package?package=podman&project=home%3Aalvistack), which provides repositories for most Linux flavors.

</div>

#### Open Container Desktop

Connect to the **System Podman** or **System Docker** default connection and all should work.

</section>

<section class="guide-sec" id="linux-podman-docker">

### <span class="n">02</span> Podman acting as Docker

<div class="note info">

This is referred to as **Compatibility Mode** — it should support all docker features, except the docker cli (use podman instead; you can alias it if you want).

</div>

#### Start the podman api listening to `/var/run/docker.sock`

```bash
export DOCKER_HOST=/var/run/docker.sock
podman system service --time=0 unix://${DOCKER_HOST} --log-level=debug
```

After this point, one can use `podman` or `docker` or any other tool that uses the socket.

</section>

<section class="guide-sec" id="linux-dd-alt">

### <span class="n">03</span> Docker Desktop alternative

This is so easy — follow the [Quick guide](#linux-quick) to support both docker and/or podman, or just skip the podman part and focus on docker only.

</section>

<section class="guide-sec" id="linux-share">

### <span class="n">04</span> Sharing connection with Container Desktop

The `DOCKER_HOST` environment variable must be set to the same value Container Desktop is using when connected. The exact value is under **Connection info** in the **Settings** section.

</section>
