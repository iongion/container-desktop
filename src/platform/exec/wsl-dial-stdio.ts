import { ContainerEngine } from "@/env/Types";

/**
 * Build the `wsl.exe` argv that runs the engine's OWN `system dial-stdio` inside a WSL distribution, bridging
 * its in-distro API socket to stdio. This is the native replacement for the removed in-distro relay binary —
 * nothing is injected into the distro anymore; we just exec the engine that already lives there. Podman takes
 * the target socket via its `--url` global flag, Docker via `-H`, so a non-default (rootless/custom) socket
 * still resolves correctly.
 */
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
