// ProvisioningService — the renderer-side orchestrator that takes a decided plan and drives it to a
// working engine. It mirrors BuildAdapter's proven shape: it runs IN THE RENDERER, streams the finite
// Command.ExecuteStreaming primitive (never the buffering Execute / the retry-loop service), and consumes
// the StreamHandle locally — so there is no broker/bus/IPC. Progress reaches the wizard as StepEvents fed
// straight into provisioningStore.applyEvent.
//
// Layering: this package may import container-client (detector/Command); container-client must NOT import
// back (that would cycle). Application-backed verify + the connection descriptor are injected by the store
// wiring (renderer is the single config owner), so nothing here writes connection config.

import { findProgramPath, findProgramVersion } from "@/container-client/detector";
import { ContainerEngine, Presence } from "@/container-client/types/engine";
import type { OperatingSystem } from "@/container-client/types/os";
import { createLogger } from "@/logger";
import { runSteps, type StepExecutor } from "./orchestrator";
import {
  appleContainerInstallCommands,
  limaCreateCommands,
  linuxInstallCommands,
  podmanMachineInitCommands,
  type StreamCommand,
  wslImportCommands,
} from "./osCommands";
import { capabilitiesFor } from "./platform";
import { detectScopes } from "./scopeDetection";
import type {
  DetectedProgram,
  DetectionReport,
  Overall,
  ProvisionPlan,
  ProvisionStep,
  ProvisionTarget,
  ReadinessReport,
  StepEvent,
} from "./types";

const logger = createLogger("container-provisioning.service");

// Programs we probe to pick the ladder rung and spot reusable runtimes. `container` = Apple Container
// (macOS only); wsl/limactl/ssh are the provisioning transports. Probing an OS-irrelevant one just
// reports MISSING, which is harmless.
export const PROBE_PROGRAMS = ["podman", "docker", "container", "wsl", "limactl", "ssh"] as const;

// The action the executor performs for a step. Provisioning kinds (install/create/import) run streamed
// commands; control-only kinds succeed in place; verify runs the availability probe (injected hook).
export type StepAction = { kind: "ok" } | { kind: "skip"; reason: string } | { kind: "provision" } | { kind: "verify" };

// StreamCommand (program/args/scope) now lives with the per-OS builders; re-exported for existing callers.
export type { StreamCommand } from "./osCommands";

// Injected probe: resolve a program's path + version, or undefined when absent. Default is the real,
// Command-backed detector; tests pass a trivial map so detection logic is verifiable without Command.
export type ProgramProbe = (
  name: string,
  osType: OperatingSystem,
) => Promise<{ path?: string; version?: string } | undefined>;

// Hooks the store supplies at run time (the Application-backed pieces the renderer owns).
export interface RunHooks {
  verify?: (target: ProvisionTarget) => Promise<ReadinessReport>;
}

// Pure: map a plan step to the control action for it. Phase 2 enriches the *commands* (commandsForStep),
// not this routing — the shape of a run (what streams vs. what verifies) is OS-agnostic.
export function stepPlan(step: ProvisionStep, _target: ProvisionTarget): StepAction {
  switch (step.kind) {
    case "install-engine":
    case "create-vm":
    case "import-distro":
      return { kind: "provision" };
    case "verify":
      return { kind: "verify" };
    default:
      // reuse-scope / configure-volumes / connect: nothing to run at this layer (an existing VM is reused
      // as-is; volume flags live in the connection descriptor; the renderer persists + connects).
      return { kind: "ok" };
  }
}

// Pinned name for the runtime we create. (A single provisioned scope per machine keeps reuse simple.)
const PROVISION_NAME = "container-desktop";
// TODO(Phase 3): pin the rootfs URL to a released asset + verify its checksum/signature before import.
const WSL_ROOTFS_URL = "https://cdn.container-desktop.com/wsl/container-desktop-rootfs.tar.gz";

// Map a provisioning step to the real per-OS/strategy command sequence (osCommands). `scope`-tagged commands
// run INSIDE the created VM/distro (install-engine after a create/import); host commands run locally.
export function commandsForStep(
  step: ProvisionStep,
  target: ProvisionTarget,
  _osType: OperatingSystem,
): StreamCommand[] {
  const name = PROVISION_NAME;
  switch (step.kind) {
    case "install-engine": {
      if (target.strategy === "apple.container") {
        // Native Apple-silicon runtime: install the signed `container` CLI + socktainer bridge on the host
        // (idempotent; see osCommands). Experimental, macOS-only.
        return appleContainerInstallCommands();
      }
      const inScope = target.strategy === "colima.lima" || target.strategy === "wsl.import";
      const commands = linuxInstallCommands(target.engine);
      // Scoped strategies install the engine + compose INSIDE the freshly created guest.
      return inScope ? commands.map((command) => ({ ...command, scope: name })) : commands;
    }
    case "create-vm":
      // Podman uses `podman machine` (resource flags); Docker-on-Lima uses `limactl create`.
      return target.engine === ContainerEngine.PODMAN
        ? podmanMachineInitCommands(name, target.resources)
        : limaCreateCommands(name, target.engine);
    case "import-distro":
      return wslImportCommands(
        name,
        WSL_ROOTFS_URL,
        `%LOCALAPPDATA%\\container-desktop\\wsl\\${name}`,
        `%TEMP%\\${name}-rootfs.tar.gz`,
      );
    default:
      return [];
  }
}

// Pure-ish: assemble the program section of a DetectionReport from an injected probe. Order is preserved.
// Each result is also reported to onResult as it resolves, so the UI can tick programs off incrementally
// instead of blocking on the whole sweep.
export async function detectPrograms(
  names: readonly string[],
  osType: OperatingSystem,
  probe: ProgramProbe,
  onResult?: (program: DetectedProgram) => void,
): Promise<DetectedProgram[]> {
  const out: DetectedProgram[] = [];
  for (const name of names) {
    const hit = await probe(name, osType).catch(() => undefined);
    const result: DetectedProgram = hit?.path
      ? { name, present: Presence.AVAILABLE, path: hit.path, version: hit.version }
      : { name, present: Presence.MISSING };
    out.push(result);
    onResult?.(result);
  }
  return out;
}

// The real, Command-backed program probe (mirrors how detector.ts is used elsewhere).
const realProbe: ProgramProbe = async (name, osType) => {
  const path = await findProgramPath(name, { osType }).catch(() => undefined);
  if (!path) {
    return undefined;
  }
  const version = (await findProgramVersion(path, { osType }).catch(() => "")) || undefined;
  return { path, version };
};

export class ProvisioningService {
  private activeHandle?: StreamHandle;
  private canceled = false;

  constructor(
    private readonly osType: OperatingSystem,
    private readonly probe: ProgramProbe = realProbe,
  ) {}

  // Cancel an in-flight run: kill the active command and stop before the next step starts. runSteps sees the
  // rejection/throw and halts, leaving the remaining steps pending.
  cancel(): void {
    this.canceled = true;
    this.activeHandle?.kill("SIGTERM");
  }

  // Probe the host for engines + transports. Reusable-VM enumeration (raw, engine-gate-bypassing) is
  // layered on in Phase 2; until then scopes is empty and the ladder is chosen from program presence.
  async detect(onResult?: (program: DetectedProgram) => void): Promise<DetectionReport> {
    // Probe only the programs relevant to this OS (no WSL on Linux, no Lima/Apple on Windows, etc.).
    const programs = await detectPrograms(capabilitiesFor(this.osType).probes, this.osType, this.probe, onResult);
    // Enumerate reusable VMs/distros raw (bypassing the engine gate) so the wizard can offer to reuse one.
    const scopes = await detectScopes(programs, async (program, args) => {
      const result = await Command.Execute(program, args);
      return result?.success ? (result.stdout ?? "") : "";
    }).catch(() => []);
    return { osType: this.osType, programs, scopes };
  }

  // Drive the plan, emitting StepEvents. Halts at the first failing step (see runSteps).
  async run(plan: ProvisionPlan, emit: (event: StepEvent) => void, hooks: RunHooks = {}): Promise<Overall> {
    this.canceled = false;
    return runSteps(plan.steps, this.executor(plan.target, hooks), emit);
  }

  private executor(target: ProvisionTarget, hooks: RunHooks): StepExecutor {
    return async (step, onLine) => {
      if (this.canceled) {
        throw new Error("Provisioning was canceled");
      }
      const action = stepPlan(step, target);
      switch (action.kind) {
        case "skip":
          return { status: "skip", reason: action.reason };
        case "ok":
          return { status: "ok" };
        case "verify": {
          if (!hooks.verify) {
            onLine("Readiness verification runs when the wizard drives the plan.");
            return { status: "ok" };
          }
          const report = await hooks.verify(target);
          for (const item of report.items) {
            onLine(`${item.ok ? "✓" : "✗"} ${item.label}: ${item.detail}`);
          }
          if (!report.ready) {
            throw new Error("The engine is not ready yet");
          }
          return { status: "ok" };
        }
        default: {
          for (const cmd of commandsForStep(step, target, this.osType)) {
            await this.stream(cmd, onLine);
          }
          return { status: "ok" };
        }
      }
    };
  }

  // Stream one command, forwarding each stdout/stderr line to onLine and settling on exit. Non-zero exit
  // (or a stream error) rejects, which runSteps turns into step.fail. Mirrors BuildAdapter.wireHandle.
  private async stream(cmd: StreamCommand, onLine: (line: string) => void): Promise<void> {
    if (this.canceled) {
      throw new Error("Provisioning was canceled");
    }
    const handle = await Command.ExecuteStreaming(cmd.program, cmd.args);
    this.activeHandle = handle;
    return await new Promise<void>((resolve, reject) => {
      handle.on("data", (payload: any) => {
        const text = `${payload?.data ?? ""}`;
        for (const line of text.split(/\r?\n/)) {
          if (line) {
            onLine(line);
          }
        }
      });
      handle.on("error", (payload: any) => {
        logger.error("Provisioning stream error", payload);
        reject(payload?.error instanceof Error ? payload.error : new Error(`${payload?.error ?? "stream error"}`));
      });
      handle.on("exit", (payload: any) => {
        handle.dispose();
        const code = typeof payload?.code === "number" ? payload.code : null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed (exit ${code}): ${cmd.program} ${cmd.args.join(" ")}`));
        }
      });
    });
  }
}
