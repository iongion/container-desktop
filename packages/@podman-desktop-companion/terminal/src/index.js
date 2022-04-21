const os = require("os");
// vendors
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");

async function launchTerminal(command, params) {
  const osType = os.type();
  console.debug("Launching terminal", command, params);
  const args = [command].concat(params).join(" ");
  let status;
  if (osType === "Darwin") {
    status = await exec_launcher("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
  } else if (osType === "Windows_NT") {
    throw new Error("Not supported yet");
  } else {
    status = await exec_launcher("gnome-terminal", ["-e", args]);
  }
  return status;
}

module.exports = {
  launchTerminal
};
