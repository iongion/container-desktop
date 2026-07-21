# Agent tool descriptions

## runCommand

Run a command on the host to inspect or fix the user's container setup. Depending on the user's permission settings the command may run, be surfaced for the user to approve, or be rejected. Never assume it ran; use its returned output. Provide a bare program and an args array—no shell, pipes, or redirects.

## runCommand.program

The executable to run, for example `podman` or `docker`. Use a bare program name, never a path or shell.

## runCommand.args

Arguments as an array of separate strings, never a single shell line.

## searchKnowledge

Search the built-in Podman, Docker, WSL, and SSH troubleshooting knowledge bank for known fixes.

## webSearch

Search the public web for a container error message or fix. Use only when local knowledge is insufficient.

## listConnections

List the configured container-engine connections (id, name, engine, running). Pass a connection's id as `connectionId` on other tools to target a specific engine; omit it to use the primary connection.

## listContainers

List containers in all states for a connection. Returns id, name, image, and state.

## inspectContainer

Inspect one container by id or name. Returns its full configuration and state.

## getContainerLogs

Fetch recent logs for a container. `tail` caps the number of lines (default 200); `since` is an optional timestamp.

## getContainerStats

Get a one-shot CPU and memory usage snapshot for a container.

## listImages

List images for a connection. Returns id, name, tag, and size.

## inspectImage

Inspect one image by id or name. Returns its full configuration.

## listNetworks

List networks for a connection. Returns id, name, and driver.

## inspectNetwork

Inspect one network by id or name.

## listVolumes

List volumes for a connection. Returns name, driver, and mountpoint.

## inspectVolume

Inspect one volume by name.

## startContainer

Start a container by id or name.

## stopContainer

Stop a running container by id or name.

## restartContainer

Restart a container by id or name.

## pauseContainer

Pause a running container by id or name.

## unpauseContainer

Resume a paused container by id or name.

## removeContainer

Remove a container forcibly by id or name. This is destructive.

## removeImage

Remove an image by id or name. This is destructive.

## removeNetwork

Remove a network by id or name. This is destructive.

## removeVolume

Remove a volume by name. This is destructive.

## pullImage

Pull an image by reference, for example `docker.io/library/nginx:latest`. This reaches the network.
