export async function launchTerminal(command, params?: any[], opts?: any) {
  console.debug("Launching terminal", command, params);
  const args = [command].concat(params || []).join(" ");
  let status;
  if (CURRENT_OS_TYPE === "Darwin") {
    status = await Command.Execute("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
  } else if (CURRENT_OS_TYPE === "Windows_NT") {
    status = await Command.Execute("wt", ["-w", "nt", "--title", opts?.title || "PDC Shell", "-p", "Command Prompt", "-d", ".", "cmd", "/k", command, ...(params || [])]);
  } else {
    status = await Command.Execute("xterm", ["-e", args]);
  }
  return status;
}
