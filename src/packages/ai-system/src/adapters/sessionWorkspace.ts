// Which folder the app acts on when it acts on the agent's behalf.
//
// There are two independent notions of "the workspace": the one in Settings → AI, and the one the running session
// mounted, chosen in the start drawer. Everything host-side that the session can reach — `/changes.*`, the project
// rules and memories it is given, the workspace tools the app performs for it — must follow the SESSION's, or it
// reads and diffs a folder the container never had. Silently right while they coincide; silently wrong otherwise.
//
// A reader is bound rather than a value pushed: the session store already owns the live spec, so there is no second
// copy to keep in step and no stop/restart path that can leave a stale path behind.

let readSessionWorkspace: (() => string | undefined) | undefined;

export function bindSessionWorkspace(reader: (() => string | undefined) | undefined): void {
  readSessionWorkspace = reader;
}

export function sessionWorkspaceRoot(
  fallback: () => Promise<string | undefined> | string | undefined,
): () => Promise<string | undefined> {
  return async () => {
    const session = readSessionWorkspace?.()?.trim();
    return session || (await fallback());
  };
}
