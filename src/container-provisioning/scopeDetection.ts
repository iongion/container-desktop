// Raw reuse detection — enumerate VMs/distros that EXIST at the controller level, independent of whether an
// engine is installed inside them yet (the exact reuse case). We can't use Application.getControllerScopes /
// listScopes here: those gate on host.isEngineAvailable() (correction #11), so "VM exists but engine not
// installed" returns empty. Instead we run the underlying list commands directly and parse them (pure).
//
// `usable` is a best-effort running-state heuristic; confirming the engine is actually reachable inside a
// scope needs an in-scope probe (a Phase-3 refinement on real hardware).

import { Presence } from "@/env/Types";

import type { DetectedProgram, DetectedScope } from "./types";

const isPresent = (programs: DetectedProgram[], name: string) =>
  programs.some((p) => p.name === name && p.present === Presence.AVAILABLE);

// `podman machine list --format json` → an array of { Name, Running }.
export function parsePodmanMachineList(stdout: string): DetectedScope[] {
  try {
    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((machine: any) => ({
      kind: "podman.machine",
      name: machine.Name ?? machine.name ?? "",
      usable: Boolean(machine.Running ?? machine.running),
    }));
  } catch {
    return [];
  }
}

// `limactl list --format json` → one JSON object per line ({ name, status }).
export function parseLimaList(stdout: string): DetectedScope[] {
  return (stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const instance = JSON.parse(line);
        return [{ kind: "lima.instance" as const, name: instance.name ?? "", usable: instance.status === "Running" }];
      } catch {
        return [];
      }
    });
}

// `wsl --list --quiet` → distro names, one per line (NUL-padded UTF-16 on Windows; the transport decodes it,
// but strip stray NULs + the header line defensively).
export function parseWslList(stdout: string): DetectedScope[] {
  return (stdout || "")
    .split(/\r?\n/)
    .map((line) => line.replaceAll("\u0000", "").trim())
    .filter((line) => line.length > 0 && !/^Windows Subsystem|^NAME\b/i.test(line))
    .map((name) => ({ kind: "wsl.distro", name, usable: true }));
}

// Enumerate reusable scopes for whichever controllers are installed. `run` returns a command's stdout (or ""
// on failure); it's injected so the parsing/merging logic is testable without a real Command.
export async function detectScopes(
  programs: DetectedProgram[],
  run: (program: string, args: string[]) => Promise<string>,
): Promise<DetectedScope[]> {
  const safeRun = async (program: string, args: string[]) => {
    try {
      return await run(program, args);
    } catch {
      return "";
    }
  };
  const scopes: DetectedScope[] = [];
  if (isPresent(programs, "podman")) {
    scopes.push(...parsePodmanMachineList(await safeRun("podman", ["machine", "list", "--format", "json"])));
  }
  if (isPresent(programs, "limactl")) {
    scopes.push(...parseLimaList(await safeRun("limactl", ["list", "--format", "json"])));
  }
  if (isPresent(programs, "wsl")) {
    scopes.push(...parseWslList(await safeRun("wsl", ["--list", "--quiet"])));
  }
  return scopes;
}
