import cp from "node:child_process";

const child = cp.spawn("./bin/container-desktop-ssh-relay.exe", [
  "--named-pipe",
  "npipe:////./pipe/container-desktop-ssh-relay-host.87a47402-2c35-4522-9508-98bf9e6f3053.docker.virtualized.wsl",
  "--ssh-connection",
  "ssh://istoica@localhost:50508/var/run/docker.sock",
  "--ssh-timeout",
  "15",
  "--identity-path",
  "./temp/id_rsa",
  "--distribution",
  "Ubuntu-24.04",
  "--relay-program-path",
  "./bin/container-desktop-ssh-relay-sshd",
  "--watch-process-termination",
  "--generate-key-pair",
  "--host",
  "localhost",
  "--port",
  "50508"
]);
child.stdin.setEncoding("utf-8");
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
