import os from "node:os";
// vendors
// project
import { exec_launcher } from "@/executor";

export async function launchTerminal(command, params?: any[], opts?: any) {
  const osType = os.type();
  console.debug("Launching terminal", command, params);
  const args = [command].concat(params || []).join(" ");
  let status;
  if (osType === "Darwin") {
    status = await exec_launcher("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
  } else if (osType === "Windows_NT") {
    status = await exec_launcher("wt", [
      "-w",
      "nt",
      "--title",
      opts?.title || "PDC Shell",
      "-p",
      "Command Prompt",
      "-d",
      ".",
      "cmd",
      "/k",
      command,
      ...(params || [])
    ]);
  } else {
    status = await exec_launcher("gnome-terminal", ["-e", args]);
  }
  return status;
}

export default {
  launchTerminal
};
