import { hostMachine, hostSystem } from "@/cli/lib/host";

// Maps a release TARGET (fine-grained like `linux-arm64`, or coarse like `linux`) to the
// `package:tauri:*` yarn script that builds it, falling back to the host system/machine for the
// coarse targets. Pure so the mapping is unit-tested (see __tests__/bundle-target.test.ts).

const DEFAULT_TARGET = "linux";

export function isArmMachine(machine: string): boolean {
  return ["aarch64", "arm64", "arm"].includes(machine.toLowerCase());
}

export function bundleScriptForTarget(target?: string, system?: string, machine?: string): string {
  const resolvedTarget = target || process.env.TARGET || DEFAULT_TARGET;
  if (resolvedTarget === "linux-x64") {
    return "package:tauri:linux_x86";
  }
  if (resolvedTarget === "linux-arm64") {
    return "package:tauri:linux_arm";
  }
  if (resolvedTarget === "macos-arm64") {
    return "package:tauri:mac_arm";
  }
  if (resolvedTarget === "windows-x64") {
    return "package:tauri:win_x64";
  }
  if (resolvedTarget === "windows-arm") {
    return "package:tauri:win_arm";
  }

  const resolvedSystem = system || hostSystem();
  const resolvedMachine = machine || hostMachine();
  if (resolvedTarget === "linux") {
    return isArmMachine(resolvedMachine) ? "package:tauri:linux_arm" : "package:tauri:linux_x86";
  }
  if (resolvedTarget === "macos" || resolvedSystem === "Darwin") {
    return "package:tauri:mac_arm";
  }
  if (resolvedTarget === "windows" || resolvedSystem === "Windows") {
    return isArmMachine(resolvedMachine) ? "package:tauri:win_arm" : "package:tauri:win_x64";
  }
  throw new Error(`Unsupported bundle target: ${resolvedTarget}`);
}
