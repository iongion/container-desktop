// Reaching a Podman *machine* engine natively on Windows. Newer Podman exposes the machine API as a Windows
// named pipe (npipe:////./pipe/podman-machine-default), listed in `podman system connection list`. When
// present that pipe is dialable directly from a native Windows process — no relay, no SSH, no dial-stdio. These
// pure helper picks the pipe out of the connection list; the transport dials it. Older WSL-ssh machines expose
// only ssh:// URIs (no pipe) ⇒ undefined ⇒ the caller keeps its bridge path.
//
// Recognising a pipe ENDPOINT, and reading its name, live in `@/utils` beside `getWindowsPipePath`, which is
// what produces those paths: the platform hosts have to answer the same question when deciding whether a
// presence check may open the path, and this dialect is not a package they can import.

import { getWindowsPipeName, getWindowsPipePath } from "@/utils";
import { preferRootlessMachineConnection } from "./podman-machine-connections";

interface PodmanConnectionEntry {
  Name?: string;
  URI?: string;
  IsMachine?: boolean;
  Default?: boolean;
}

const NPIPE_SCHEME = /^npipe:\/\//i;

// From the parsed `podman system connection list --format json`, return the machine's Windows named-pipe path
// (`\\.\pipe\<name>`) when Podman exposes one, else undefined. Prefers the ROOTLESS machine connection (never the
// rootful `-root` pipe, which the app does not target) — mirroring the SSH bridge selection in podman-machine-ssh.ts.
export function parsePodmanMachineNamedPipe(connections: unknown): string | undefined {
  const entries: PodmanConnectionEntry[] = Array.isArray(connections) ? connections : [];
  const machines = entries.filter(
    (entry) => entry?.IsMachine === true && typeof entry.URI === "string" && NPIPE_SCHEME.test(entry.URI),
  );
  const chosen = preferRootlessMachineConnection(machines);
  const name = chosen?.URI ? getWindowsPipeName(chosen.URI) : undefined;
  return name ? getWindowsPipePath(name, true) : undefined;
}
