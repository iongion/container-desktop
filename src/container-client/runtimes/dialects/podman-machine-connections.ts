// Shared parsing of `podman system connection list --format json` for the podman-machine paths (scope, native
// pipe, and SSH bridge). Podman gives every machine TWO connections: `<machine>` (rootless) and `<machine>-root`
// (rootful). Container Desktop targets ROOTLESS podman only, so these helpers exist to always pick the rootless
// connection — even when podman marks the rootful `-root` one as Default (as it does on some WSL machines).

const ROOTFUL_SUFFIX = /-root$/i;

// True when a podman connection name is the rootful one (`<machine>-root`).
export function isRootfulPodmanConnectionName(name: string | undefined | null): boolean {
  return ROOTFUL_SUFFIX.test((name ?? "").trim());
}

// Map a connection name back to its machine name by stripping the rootful `-root` suffix. Returns "" for empty.
export function podmanMachineNameFromConnectionName(name: string | undefined | null): string {
  return (name ?? "").trim().replace(ROOTFUL_SUFFIX, "");
}

// From a list of machine connection entries, pick the one to use. Prefers a ROOTLESS connection (name not ending
// in `-root`), honouring the Default flag among the rootless ones; only when there is no rootless connection at
// all does it fall back to the Default/first rootful entry. Returns undefined for an empty list. Generic so the
// pipe and SSH selectors (which carry extra fields) can reuse it.
export function preferRootlessMachineConnection<T extends { Name?: string; Default?: boolean }>(
  machines: T[],
): T | undefined {
  if (!machines.length) {
    return undefined;
  }
  const rootless = machines.filter((entry) => !isRootfulPodmanConnectionName(entry.Name));
  const pool = rootless.length ? rootless : machines;
  return pool.find((entry) => entry.Default) ?? pool[0];
}

interface PodmanSystemConnectionEntry {
  Name?: string;
  IsMachine?: boolean;
  Default?: boolean;
}

// Choose the machine scope (name) that backs podman's default connection. Prefers the rootless machine
// connection (never the rootful `-root`), maps it to a machine name, and matches it against the known machine
// names case-insensitively; when the mapped name is unknown but exactly one machine exists, that sole machine is
// used. Returns the chosen machine name (or undefined) plus a human-readable reason for logging the decision or
// the mismatch — the transport logs this so a scope failure names the connection and the available machines
// instead of a bare "no default scope".
export function selectDefaultMachineScopeName(
  connections: unknown,
  machineNames: string[],
): { name?: string; reason: string } {
  const entries: PodmanSystemConnectionEntry[] = Array.isArray(connections) ? connections : [];
  const machineConnections = entries.filter((entry) => entry?.IsMachine === true);
  const chosen = preferRootlessMachineConnection(machineConnections) ?? entries[0];
  if (!chosen) {
    return { reason: "no podman system connections" };
  }
  const connectionName = (chosen.Name ?? "").trim();
  const mapped = podmanMachineNameFromConnectionName(connectionName);
  const match = machineNames.find((name) => name?.trim().toLowerCase() === mapped.toLowerCase());
  if (match) {
    const note = isRootfulPodmanConnectionName(connectionName) ? " (rootful default remapped to rootless machine)" : "";
    return { name: match, reason: `default connection "${connectionName}" -> machine "${match}"${note}` };
  }
  if (machineNames.length === 1) {
    return {
      name: machineNames[0],
      reason: `default connection "${connectionName}" named no known machine; using the only machine "${machineNames[0]}"`,
    };
  }
  return {
    reason: `default connection "${connectionName}" (machine "${mapped}") matches none of [${machineNames.join(", ")}]`,
  };
}
