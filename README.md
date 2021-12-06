# Podman Desktop Companion

A familiar desktop graphical interface to the free and open container manager, [podman!](https://podman.io/)

<video controls poster="docs/img/001-Dashboard.png?raw=true" width="70%">
  <source src="docs/videos/demo.mp4" type="video/mp4" />
</video>

Main goals

* Cross-platform desktop integrated application with consistent UI
* Learning tool for the powerful `podman` command line interface

Graphically exposed features for common usage scenarios

* Application status
  * Dashboard - offering just the essentials for the users to feel right at home
* Content management systems for
  * Containers
    * Be informed about the origin and status of your container environment.
    * Quickly access logs, environment variables, mounts, opened ports and monitoring stats.
    * Perform common maintenance operations, stop, restart and remove easily.
    * Direct access to the exposed services using your browser
    * Gain control of all that happens in the container using the terminal console
  * Images
    * Be informed about the origin and status of local image store, their registry, name and tag.
    * Immediately spawn new containers from image, customize name, port mappings and available mounts
    * Quickly access image build-up, check their impact and debug their setup
    * In-depth configuration viewer
    * Perform common maintenance operations, pull latest updates to refresh the images, push latest changes to a distributed image project.
  * Machines
    * Manage all available podman virtual machines, create new ones or decommission what is redundant.
  * Secrets
    * Be aware of all available secrets, define new ones or purge old from existence
  * Volumes
    * Manage shared volumes across containers, limit repetition and also be portable
* General configuration
  * Application settings
    * Status and configuration options
  * Common tasks
    * Help
    * Maintenance
