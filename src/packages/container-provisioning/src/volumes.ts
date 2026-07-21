// Volume + permission resolution — turns chosen host folders into concrete mount specs using the OS×engine
// decision table, and renders the exact `-v` / userns flags the wizard applies. This is the make-or-break
// "just works" piece; see docs/architecture/provisioning.md. (Guest-path steering for WSL and the ownership
// probe land in Phase 3.)

import type { ContainerEngine } from "@/container-client/types/engine";
import type { OperatingSystem } from "@/container-client/types/os";

import { resolveMountDecision } from "./decisionTable";
import type { IdStrategy, VolumeMountSpec } from "./types";

export interface FolderChoice {
  hostPath: string;
  mode: "rw" | "ro";
}

// Append a newly picked folder (read-write by default), skipping duplicates so each host path is mounted
// once. Returning the same array reference when nothing changes keeps the caller's key stable and its
// effects quiet. Host path is unique after this, so it's a safe React key.
export function addFolderChoice(current: FolderChoice[], hostPath: string): FolderChoice[] {
  if (current.some((folder) => folder.hostPath === hostPath)) {
    return current;
  }
  return [...current, { hostPath, mode: "rw" }];
}

// The short label for a chosen folder — its final path segment (e.g. "Downloads"), since the full host path
// is already shown in the `-v host:guest` preview. Handles POSIX and Windows separators; "~" (home) and a
// filesystem root keep their literal form rather than collapsing to empty.
export function folderDisplayName(hostPath: string): string {
  const trimmed = hostPath.replace(/[/\\]+$/, "");
  if (!trimmed) {
    return hostPath; // "" or a pure-slash root — show as-is
  }
  return trimmed.split(/[/\\]/).pop() || trimmed;
}

// Apply the OS×engine id strategy to each chosen folder. Guest path mirrors the host path for now (correct
// for native binds + virtiofs); Phase 3 steers WSL projects into the Linux filesystem.
export function resolveVolumeSpecs(
  os: OperatingSystem,
  engine: ContainerEngine,
  folders: FolderChoice[],
): VolumeMountSpec[] {
  const decision = resolveMountDecision(os, engine);
  return folders.map((folder) => ({
    hostPath: folder.hostPath,
    guestPath: folder.hostPath,
    mode: folder.mode,
    idStrategy: decision.idStrategy,
  }));
}

// The `-v host:guest[:opts]` preview for one spec. Options are comma-joined: `ro` for read-only, `U` to
// chown the volume to the keep-id-mapped user (the Podman `:U` flag).
export function volumePreview(spec: VolumeMountSpec): string {
  const opts: string[] = [];
  if (spec.mode === "ro") {
    opts.push("ro");
  }
  if (spec.idStrategy === "keep-id+U") {
    opts.push("U");
  }
  return `-v ${spec.hostPath}:${spec.guestPath}${opts.length ? `:${opts.join(",")}` : ""}`;
}

// The run-level flag implied by an id strategy (shown once, applied to `run`/compose). keep-id maps the
// container user to the host UID; run-as-user runs as the invoking user; none needs nothing.
export function usernsFlag(idStrategy: IdStrategy): string | undefined {
  if (idStrategy === "keep-id" || idStrategy === "keep-id+U") {
    return "--userns=keep-id";
  }
  if (idStrategy === "run-as-user") {
    return "-u $(id -u):$(id -g)";
  }
  return undefined;
}
