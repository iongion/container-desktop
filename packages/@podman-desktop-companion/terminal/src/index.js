// vendors
// project
const { exec } = require("@podman-desktop-companion/executor");

async function launchTerminal(command, params, opts) {
  console.debug("Launching terminal", command, params);
  const args = [command].concat(params).join(" ");
  let status;
  if (opts.isLIMA) {
    const limaWrap = ["limactl", "shell", "podman", args].join(" ");
    status = await exec("osascript", ["-e", `tell app "Terminal" to do script "${limaWrap}"`]);
  } else if (opts.isWSL) {
    throw new Error("Not supported yet");
  } else {
    status = await exec("gnome-terminal", ["-e", args]);
  }
  return status;
}

module.exports = {
  launchTerminal
};
