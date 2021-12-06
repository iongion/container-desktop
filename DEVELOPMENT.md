# App and API

## Local development

### Requirements

* node
* nvm to activate and manage multiple node versions
* bash friendly terminal
* tmux
* make

### TLDR

* `make start` to start development web server and the react application
* `make shell.start` to start the native shell integration

Start API as socket (`socketPath` for axios)

* `podman system service --time=0 unix:///tmp/podman.sock --log-level=debug`

Test socket with `curl --unix-socket /run/podman/podman.sock http://d/v3.0.0/libpod/info`

Start API as http server - HTTP api is only for development!

* `podman system service tcp:localhost:8081 --time=0 --log-level=debug --cors="*"`

Test http api with `curl -X GET http://localhost:8081/v3.0.0/libpod/info`

## Deployment

podman system connection add default "//wsl.localhost/Ubuntu-20.04/home/$USER/.ssh/id_rsa" --socket-path "\\wsl.localhost\Ubuntu-20.04\mnt\wslg\runtime-dir\podman\podman.sock"

## Get URI

> podman system connection ls

## Create tunnel

> ssh -nNT -L/tmp/podman.sock:/run/user/1000/podman/podman.sock -i ~/.ssh/podman-machine-default ssh://core@localhost:[PORT]

## Export socket location

> export DOCKER_HOST='/tmp/podman.sock'

## Set executable icon on windows

rcedit-x64.exe YourExe.exe --set-icon icon.ico
