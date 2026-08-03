import type { EngineConnectorSettings } from "@/container-client/types/connection";
import type { CommandExecutionResult } from "@/host-contract/exec";
import { expandHome } from "@/utils";
import type { HostContext } from "../composition";

const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function scope(settings: EngineConnectorSettings): string {
  return settings.controller?.scope || "";
}

export async function runScopedSocketCommand(
  host: HostContext,
  settings: EngineConnectorSettings,
  program: string,
  args: string[],
): Promise<CommandExecutionResult> {
  const target = scope(settings);
  if (!target) {
    return { pid: null, code: 1, success: false, stdout: "", stderr: "SSH scope is not set" };
  }
  return await host.runScopeCommand(program, args, target, settings);
}

export function normalizeUnixSocketPath(value: string | undefined | null): string {
  const socket = `${value || ""}`.trim();
  if (!socket) {
    return "";
  }
  if (/^unix:\/\//i.test(socket)) {
    return socket.replace(/^unix:\/\//i, "");
  }
  // A Windows engine endpoint is a named pipe (npipe://…), not a Unix socket. Keep it verbatim: it can't be
  // `ssh -NL` forwarded, but the SSH transport bridges it via `docker system dial-stdio`. Other schemes (tcp,
  // http, …) are still rejected — we only speak over Unix sockets / named pipes.
  if (/^npipe:\/\//i.test(socket)) {
    return socket;
  }
  if (URI_SCHEME_PATTERN.test(socket)) {
    return "";
  }
  return socket;
}

export async function readScopedHome(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
  const output = await runScopedSocketCommand(host, settings, "printenv", ["HOME"]);
  return output.success ? `${output.stdout || ""}`.trim() : "";
}

export async function expandScopedSocketPath(
  host: HostContext,
  settings: EngineConnectorSettings,
  value: string | undefined | null,
): Promise<string> {
  const socket = normalizeUnixSocketPath(value);
  if (!socket || (!socket.startsWith("~") && !socket.includes("$HOME"))) {
    return socket;
  }
  const home = await readScopedHome(host, settings);
  return home ? expandHome(socket, home) : socket;
}

export async function isScopedMacOS(host: HostContext, settings: EngineConnectorSettings): Promise<boolean> {
  const output = await runScopedSocketCommand(host, settings, "uname", ["-s"]);
  return output.success && `${output.stdout || ""}`.trim() === "Darwin";
}

export function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function findSocketPathCandidate(value: unknown, socketName: string): string {
  if (typeof value === "string") {
    const escapedName = socketName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = value.match(new RegExp(`(?:unix://)?(?:~|\\$HOME|/)[^\\s"',]+${escapedName}`, "i"));
    if (match) {
      return normalizeUnixSocketPath(match[0]);
    }
    const direct = normalizeUnixSocketPath(value);
    return direct.endsWith(socketName) && !/\s/.test(direct) ? direct : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSocketPathCandidate(item, socketName);
      if (found) {
        return found;
      }
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findSocketPathCandidate(item, socketName);
      if (found) {
        return found;
      }
    }
  }
  return "";
}
