// Reaching a Podman *machine* engine natively on Windows. Newer Podman exposes the machine API as a Windows
// named pipe (npipe:////./pipe/podman-machine-default), listed in `podman system connection list`. When
// present that pipe is dialable directly from a native Windows process — no relay, no SSH, no dial-stdio. These
// pure helpers pick the pipe out of the connection list and recognise a pipe endpoint; the transport dials it.
// Older WSL-ssh machines expose only ssh:// URIs (no pipe) ⇒ undefined ⇒ the caller keeps its bridge path.

import { getWindowsPipePath } from "@/utils";
import { preferRootlessMachineConnection } from "./podman-machine-connections";

interface PodmanConnectionEntry {
  Name?: string;
  URI?: string;
  IsMachine?: boolean;
  Default?: boolean;
}

const NPIPE_SCHEME = /^npipe:\/\//i;

// True for a Windows named-pipe endpoint in any form the app passes around: an `npipe://` URI, a `\\.\pipe\…`
// path (what `getWindowsPipePath` and Podman's `ConnectionInfo.PodmanPipe.Path` produce), or its forward-slash
// `//./pipe/…` variant. Unix sockets and ssh URIs are false.
export function isWindowsNamedPipe(uri: string | undefined | null): boolean {
  if (!uri) {
    return false;
  }
  const value = uri.trim();
  return NPIPE_SCHEME.test(value) || /^(?:\\\\|\/\/)[.?][\\/]pipe[\\/]/i.test(value);
}

function extractPipeName(uri: string): string | undefined {
  const match = /[\\/]pipe[\\/]([^\\/]+?)\/?$/i.exec(uri.trim());
  return match ? match[1] : undefined;
}

// From the parsed `podman system connection list --format json`, return the machine's Windows named-pipe path
// (`\\.\pipe\<name>`) when Podman exposes one, else undefined. Prefers the ROOTLESS machine connection (never the
// rootful `-root` pipe, which the app does not target) — mirroring the SSH bridge selection in podman-machine-ssh.ts.
export function parsePodmanMachineNamedPipe(connections: unknown): string | undefined {
  const entries: PodmanConnectionEntry[] = Array.isArray(connections) ? connections : [];
  const machines = entries.filter(
    (entry) => entry?.IsMachine === true && typeof entry.URI === "string" && NPIPE_SCHEME.test(entry.URI),
  );
  const chosen = preferRootlessMachineConnection(machines);
  const name = chosen?.URI ? extractPipeName(chosen.URI) : undefined;
  return name ? getWindowsPipePath(name, true) : undefined;
}
