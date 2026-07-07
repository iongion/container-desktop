// The Wails-side SSH control plane — Command.StartSSHConnection + the ISSHClient it returns. Entirely JS: it
// reuses the shared, pure buildSSHArgs (@/container-client/ssh-args) over the already-Go-backed
// Command.Execute / Command.ExecuteStreaming, so NO new native code is needed for exec-over-SSH. The DATA
// plane (the engine-API dial over an SSH dial-stdio bridge / `ssh -NL` tunnel) is owned by the Go proxy
// (src-wails/proxy.go) — hence startTunnel/startStdioBridge are inert here (Command.ProxyRequest is the
// Go proxy-request bridge, which never calls back into this client).
//
// Why the argv needs no credential/home resolution in Go: every SSH scope comes from ~/.ssh/config
// (Platform.getSSHConfig), so ConfigHost is always set — buildSSHArgs then drops -i/-p and the ssh target is
// just the config alias. deps are injected so the probe/exec flow is unit-testable with fakes.

import { EventEmitter } from "eventemitter3";
import type { ISSHClient } from "@/container-client/services";
import { buildSSHArgs, type SSHClientConnection } from "@/container-client/ssh-args";
import type { CommandExecutionResult } from "@/env/Types";
import type { StreamHandle } from "@/platform/contract";

// (SSH_CONNECT_TIMEOUT_SECONDS + 5) * 1000 — matches services.ts SSH_COMMAND_TIMEOUT_MS.
const SSH_COMMAND_TIMEOUT_MS = 20000;
const SSH_ESTABLISHED = "SSH connection established";

// The SSHHost fields we read (env/Types.ts SSHHost). Structural so a scope object satisfies it directly.
export interface SSHHostLike {
  Name: string;
  Host: string;
  Port: number;
  HostName: string;
  User: string;
  IdentityFile: string;
  ConfigHost?: string;
}

export interface SSHClientDeps {
  execute: (launcher: string, args: string[], opts?: { timeout?: number }) => Promise<CommandExecutionResult>;
  executeStreaming: (launcher: string, args: string[], opts?: any) => Promise<StreamHandle>;
  osType: string;
}

/** SSHHost → the credentials buildSSHArgs consumes (mirrors ssh-transport.ts:207). */
export function credentialsFromHost(host: SSHHostLike): SSHClientConnection {
  return {
    host: host.HostName || host.Host || host.Name,
    port: host.Port || 22,
    username: host.User || "",
    privateKeyPath: host.IdentityFile || "",
    configHost: host.ConfigHost,
  };
}

function isEstablished(output: CommandExecutionResult | undefined): boolean {
  return !!output?.success && `${output?.stdout ?? ""}`.trim() === SSH_ESTABLISHED;
}

/** Command.StartSSHConnection — run the echo connect-probe; on success return a live ISSHClient. */
export async function startSSHConnection(deps: SSHClientDeps, host: SSHHostLike, _opts?: any): Promise<ISSHClient> {
  const cli = deps.osType === "Windows_NT" ? "ssh.exe" : "ssh";
  const credentials = credentialsFromHost(host);
  const emitter = new EventEmitter();
  let connected = false;

  const probe = (params: SSHClientConnection): Promise<CommandExecutionResult> =>
    deps.execute(cli, buildSSHArgs(params, ["echo", SSH_ESTABLISHED]), { timeout: SSH_COMMAND_TIMEOUT_MS });

  const output = await probe(credentials);
  connected = isEstablished(output);
  if (!connected) {
    emitter.emit("error", output);
    throw new Error(`${output?.stderr ?? ""}`.trim() || "SSH connection failed");
  }
  emitter.emit("connection.established");

  const client: ISSHClient = {
    isConnected: () => connected,
    on: (event, listener, context) => {
      emitter.on(event, listener, context);
    },
    emit: (event, ...args) => emitter.emit(event, ...args),
    connect: async (params) => {
      connected = isEstablished(await probe(params));
    },
    execute: (command) => deps.execute(cli, buildSSHArgs(credentials, command), { timeout: SSH_COMMAND_TIMEOUT_MS }),
    executeStreaming: (command) => deps.executeStreaming(cli, buildSSHArgs(credentials, command)),
    // Data plane is Go-owned in the Wails shell (proxy.go bridges the dial-stdio / -NL tunnel), so the JS
    // client never manages tunnels. Inert — never reached, since Command.ProxyRequest is the Go proxy bridge.
    startTunnel: async () => {
      throw new Error("SSH tunnels are managed by the Go proxy in the Wails shell");
    },
    stopTunnel: () => undefined,
    close: () => {
      connected = false;
      emitter.removeAllListeners();
    },
  };
  return client;
}
