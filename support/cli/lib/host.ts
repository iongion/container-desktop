import os from "node:os";

// Host identification in Python's platform vocabulary, so the ports compare against the same
// strings tasks.py did (`platform.system()` -> "Linux" | "Darwin" | "Windows").

export function hostSystem(): string {
  switch (process.platform) {
    case "darwin":
      return "Darwin";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

export function hostMachine(): string {
  return typeof os.machine === "function" ? os.machine() : process.arch;
}
