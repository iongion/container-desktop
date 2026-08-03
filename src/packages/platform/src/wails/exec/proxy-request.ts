import {
  type CommandProxyStreamEvent,
  pickConnection,
  pickSerializableRequest,
  shapeBufferedResponse,
} from "@/container-client/commandProxyProtocol";
import { getProxyRequestRoute } from "@/container-client/proxy-route";
import { buildSSHArgs, buildSSHTunnelArgs } from "@/container-client/ssh-args";
import { buildWSLDialStdioArgs } from "@/container-client/wsl-args";
import { createEmitterStream } from "@/utils/streamEmitter";

// A Wails Channel, reduced to what we use: an assignable onmessage sink passed as an invoke arg.
// The Wails Channel also delivers raw ArrayBuffer frames (binary log data via InvokeResponseBody::Raw); the
// onmessage type stays the JSON-event shape (applyStreamEvent widens + handles the binary case at runtime).
export interface ProxyChannel {
  onmessage: ((message: CommandProxyStreamEvent) => void) | null;
}

export interface ProxyRequestDeps {
  invoke: (command: string, args: Record<string, unknown>) => Promise<any>;
  // Create a fresh Wails Channel (passed to proxy_request_stream; its onmessage receives stream events).
  newChannel: () => ProxyChannel;
  // Local OS type (for the ssh/ssh.exe launcher in an SSH bridge spec). Defaults to non-Windows.
  osType?: string;
}

// A remote-connection bridge the Go proxy must bring up (and dial the LOCAL end of) before proxying: an SSH
// dial-stdio bridge / `ssh -NL` tunnel, or a WSL dial-stdio bridge. Built HERE from the shared arg builders
// (the source of truth for the argv) so Go stays engine-agnostic — it only spawns `launcher argv` and shuttles
// bytes between `localAddress` and that process's stdio. `undefined` for a direct local dial.
export interface BridgeSpec {
  kind: "stdio" | "tunnel";
  key: string;
  localAddress: string;
  launcher: string;
  argv: string[];
}

// Classify the connection and, for an SSH/WSL remote, produce the bridge spec. SSH: every scope comes from
// ~/.ssh/config so ConfigHost is the alias — buildSSHArgs drops -i/-p and targets it, so no credential/home
// resolution reaches Go; dialStdioCommand present ⇒ a per-connection `ssh <alias> -- <cmd>` stdio bridge
// (Docker/Podman remotes), absent ⇒ a plain `ssh -NL` unix-socket forward. WSL: a `wsl.exe … system dial-stdio`
// stdio bridge over a named pipe, keyed by connection id.
export function buildBridgeSpec(connection: any, osType?: string): BridgeSpec | undefined {
  const route = getProxyRequestRoute(connection?.host);
  const api = connection?.settings?.api?.connection ?? {};
  const localAddress = api.uri ?? "";
  const remoteAddress = api.relay ?? "";
  if (route === "wsl") {
    const distribution = connection?.settings?.controller?.scope || "Ubuntu";
    const program = connection?.settings?.program?.name || connection?.engine;
    const socketPath = `${remoteAddress}`.replace("unix://", "");
    return {
      kind: "stdio",
      key: connection?.id ?? localAddress,
      localAddress,
      launcher: "wsl.exe",
      argv: buildWSLDialStdioArgs({ distribution, program, engine: connection?.engine, socketPath }),
    };
  }
  if (route !== "ssh") {
    return undefined; // direct → dial the socket directly
  }
  const scope = connection?.settings?.controller?.scope ?? "";
  const launcher = osType === "Windows_NT" ? "ssh.exe" : "ssh";
  const credentials = { host: scope, port: 22, username: "", configHost: scope };
  const key = remoteAddress || localAddress;
  const dialStdioCommand: string[] | undefined = api.dialStdioCommand;
  if (!remoteAddress) {
    throw new Error(
      "Remote engine socket could not be determined — is the container engine installed and running on the remote host (and reachable on a non-interactive SSH PATH)?",
    );
  }
  if (dialStdioCommand && dialStdioCommand.length > 0) {
    return { kind: "stdio", key, localAddress, launcher, argv: buildSSHArgs(credentials, dialStdioCommand) };
  }
  if (osType === "Windows_NT") {
    throw new Error(
      "No dial-stdio bridge for this SSH connection — the remote engine must support `<engine> system dial-stdio`.",
    );
  }
  return {
    kind: "tunnel",
    key,
    localAddress,
    launcher,
    argv: buildSSHTunnelArgs(credentials, localAddress, remoteAddress),
  };
}

// Translate one Go stream event into an emit on the shared EmitterStream (mirror createForwardedStream):
// data → "data"(string), end → "end", error → "error"(Error).
export function applyStreamEvent(
  emitter: { emit: (event: string, ...args: any[]) => void },
  message: CommandProxyStreamEvent | ArrayBuffer | ArrayBufferView,
): void {
  // Binary data chunk (container logs): Go sent raw bytes (InvokeResponseBody::Raw). Hand them straight to the
  // log decoder (toLogBytes accepts Uint8Array/ArrayBuffer) — no utf8-lossy corruption, no JSON copy.
  if (message instanceof ArrayBuffer) {
    emitter.emit("data", new Uint8Array(message));
    return;
  }
  if (ArrayBuffer.isView(message)) {
    emitter.emit("data", message);
    return;
  }
  switch (message?.type) {
    case "data":
      emitter.emit("data", message.payload);
      break;
    case "end":
      emitter.emit("end");
      break;
    case "error": {
      const detail = (message.payload as { message?: string } | undefined)?.message;
      emitter.emit("error", new Error(detail ?? "stream error"));
      break;
    }
  }
}

// Build the Command.ProxyRequest function from injected Wails bindings.
export function createProxyRequest(deps: ProxyRequestDeps) {
  return async function proxyRequest(request: any, connection: any, _context?: any): Promise<any> {
    const req = pickSerializableRequest(request);
    const conn = pickConnection(connection);
    // For an SSH/WSL remote, Go must bring up (and dial the local end of) a bridge; direct dials are undefined.
    const bridge = buildBridgeSpec(connection, deps.osType);
    if (req.responseType === "stream") {
      return openStream(deps, req, conn, bridge);
    }
    const response = await deps.invoke("proxy_request", { payload: { req, connection: conn, bridge } });
    return shapeBufferedResponse(response);
  };
}

async function openStream(
  deps: ProxyRequestDeps,
  req: Record<string, unknown>,
  conn: Record<string, unknown>,
  bridge: BridgeSpec | undefined,
): Promise<any> {
  // streamId is only known after the open resolves; teardown (destroy/close → onDestroy) fires later, by
  // which point it is set. Until then destroy is a no-op (nothing to tear down server-side yet).
  let streamId: string | undefined;
  const { emitter, api } = createEmitterStream({
    onDestroy: () => {
      if (streamId) {
        void deps.invoke("proxy_stream_destroy", { streamId }).catch(() => undefined);
      }
    },
  });
  const channel = deps.newChannel();
  channel.onmessage = (message) => applyStreamEvent(emitter, message);
  const handle: any = await deps.invoke("proxy_request_stream", {
    payload: { req, connection: conn, bridge },
    channel,
  });
  streamId = handle?.streamId;
  return { data: api, status: handle?.status ?? 0, statusText: "", headers: handle?.headers ?? {} };
}
