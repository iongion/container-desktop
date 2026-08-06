// Which scope a connection's engine commands run through.
//
// Two answers make one, and neither belongs to a caller: the TRANSPORT says whether commands are wrapped at all
// (`wsl -d`, `limactl shell`, `podman machine ssh`, `ssh`), and the CONNECTION says which scope they are wrapped in.
// A caller that took the scope as a parameter instead got whatever its own caller happened to know — which for the
// assistant was nothing, so its engine commands ran on THIS machine for a connection that lives on another one.
//
// `undefined` means "run it here": either the transport wraps nothing, or the connection names no scope, and both are
// answered by the plain host command every native connection uses.

import type { EngineConnectorSettings } from "@/container-client/types/connection";

import type { HostClientFacade } from "./facade";

export async function connectionCommandScope(
  host: HostClientFacade,
  settings?: EngineConnectorSettings,
): Promise<string | undefined> {
  if (!host.isScoped()) return undefined;
  const current = settings ?? (await host.getSettings());
  return current.controller?.scope || undefined;
}
