# MCP tool descriptions

## listConnections

List the container-engine connections configured in Container Desktop (id, name, engine, running). Pass a connection's id as `connectionId` to any other tool to reach that engine; leave it out to use the current connection.

## listContainers

List the containers of a connection, in every state. Returns their id, name, image and state.

## inspectContainer

Inspect one container by id or name. Returns its full configuration and state, with secrets redacted.

## getContainerLogs

Read the most recent log lines of a container. `tail` is the number of lines, from 1 to 5000 (200 when left out); `since` limits the logs to those after a timestamp.

## getContainerStats

Read a one-off CPU and memory usage snapshot of a container.

## listImages

List the images of a connection. Returns their id, name, tag and size.

## inspectImage

Inspect one image by id or name. Returns its full configuration.

## listNetworks

List the networks of a connection. Returns their id, name and driver.

## inspectNetwork

Inspect one network by id or name.

## listVolumes

List the volumes of a connection. Returns their name, driver and mountpoint.

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

Remove a container by id or name, forcibly, even when it is running, together with its anonymous volumes. This is destructive.

## removeImage

Remove an image by id or name. This is destructive.

## removeNetwork

Remove a network by id or name. This is destructive.

## removeVolume

Remove a volume by name, with the data it holds. This is destructive.

## pullImage

Pull an image by reference, for example `docker.io/library/nginx:latest`. This reaches the network.
