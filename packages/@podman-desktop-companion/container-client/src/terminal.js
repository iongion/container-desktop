// vendors
// project
const { exec, which, withClient } = require("./shell");

async function launchTerminal(command, params) {
  console.debug("Launching terminal", command, params);
  const status = await exec("gnome-terminal", ["-e", [command].concat(params).join(" ")]);
  return status;
}

module.exports = {
  launchTerminal
};
