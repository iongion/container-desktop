import { ContainerEngine } from "@/container-client/types/engine";

// Build the `wsl.exe` argv that runs the engine's OWN `system dial-stdio` inside a WSL distribution, bridging
// its in-distro API socket to stdio. Nothing is copied into the distro — we exec the podman/docker that
// already lives there. Podman takes the target socket via its `--url` global flag, Docker via `-H`, so a
// non-default (rootless/custom) socket still resolves correctly.
//
// Lives in container-client (node-free, alongside ssh-args) so BOTH the node-side WSL relay (wsl-relay.ts) and
// the Tauri webview binding (exec/proxy-request.buildBridgeSpec) build the argv from this single source of truth.
export function buildWSLDialStdioArgs(opts: {
  distribution: string;
  program: string;
  engine: ContainerEngine;
  socketPath: string;
}): string[] {
  const { distribution, program, engine, socketPath } = opts;
  const url = `unix://${socketPath}`;
  const hostFlag = engine === ContainerEngine.DOCKER ? ["-H", url] : ["--url", url];
  return ["--distribution", distribution, "--exec", program, ...hostFlag, "system", "dial-stdio"];
}
