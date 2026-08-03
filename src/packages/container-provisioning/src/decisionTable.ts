import { ContainerEngine } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

import type { MountDecision } from "./types";

// Per OS × engine: the mount type + UID/GID strategy the wizard applies automatically so a developer
// editing on the host and running in a container gets correct, writable, watchable files with zero
// manual chown. This is the make-or-break table — see docs/architecture/provisioning.md.
const TABLE: Partial<Record<OperatingSystem, Partial<Record<ContainerEngine, MountDecision>>>> = {
  [OperatingSystem.MacOS]: {
    [ContainerEngine.PODMAN]: {
      mountType: "virtiofs",
      idStrategy: "keep-id+U",
      defaultShare: "~",
      warn: "Without keep-id your host UID (e.g. 501) won't match the container user.",
    },
    [ContainerEngine.DOCKER]: {
      mountType: "virtiofs",
      idStrategy: "none",
      defaultShare: "~",
      warn: "Requires macOS 12.5+ for virtiofs.",
    },
    [ContainerEngine.APPLE]: {
      mountType: "apple.native",
      idStrategy: "none",
      defaultShare: "~",
      warn: "Experimental; Apple Container manages host mounts natively.",
    },
  },
  [OperatingSystem.Windows]: {
    [ContainerEngine.PODMAN]: {
      mountType: "native.ext4",
      idStrategy: "keep-id",
      defaultShare: "~",
      warn: "Keep projects in the Linux filesystem — never /mnt/c (inotify + permissions break there).",
    },
    [ContainerEngine.DOCKER]: {
      mountType: "native.ext4",
      idStrategy: "run-as-user",
      defaultShare: "~",
      warn: "Keep projects in the Linux filesystem — never /mnt/c (inotify + permissions break there).",
    },
  },
  [OperatingSystem.Linux]: {
    [ContainerEngine.PODMAN]: {
      // No warn: rootless subuid/subgid is set up by provisioning when missing, so there's nothing for the
      // user to worry about. Warnings are reserved for genuinely actionable traps (e.g. the /mnt/c one).
      mountType: "native.bind",
      idStrategy: "keep-id+U",
      defaultShare: "~",
    },
    [ContainerEngine.DOCKER]: {
      mountType: "native.bind",
      idStrategy: "run-as-user",
      defaultShare: "~",
    },
  },
};

// Resolve the automatic volume/permission recipe for a machine. Apple Container only exists on macOS.
export function resolveMountDecision(os: OperatingSystem, engine: ContainerEngine): MountDecision {
  if (engine === ContainerEngine.APPLE && os !== OperatingSystem.MacOS) {
    throw new Error("Apple Container is macOS-only");
  }
  const decision = TABLE[os]?.[engine];
  if (!decision) {
    throw new Error(`No mount decision for ${os} + ${engine}`);
  }
  return { ...decision };
}
