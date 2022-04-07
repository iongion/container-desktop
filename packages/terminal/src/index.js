const os = require("os");
// vendors
// project
const { exec } = require("@podman-desktop-companion/executor");

async function launchTerminal(command, params) {
  const osType = os.type();
  // console.debug("Launching terminal", command, params);
  const args = [command].concat(params).join(" ");
  let status;
  if (osType === "Darwin") {
    status = await exec("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
  } else if (osType === "Windows_NT") {
    throw new Error("Not supported yet");
  } else {
    status = await exec("gnome-terminal", ["-e", args]);
  }
  return status;
}

module.exports = {
  launchTerminal
};
