// vendors
// project
const { exec } = require("@podman-desktop-companion/executor");

async function launchTerminal(command, params) {
  console.debug("Launching terminal", command, params);
  const status = await exec("gnome-terminal", ["-e", [command].concat(params).join(" ")]);
  return status;
}

module.exports = {
  launchTerminal
};
