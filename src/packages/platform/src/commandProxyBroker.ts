// CommandProxyBroker — serves forwarded engine HTTP (Command.ProxyRequest) against ONE active host-client
// driver, so a single engine connection (SSH tunnel / WSL relay / socket pool) backs every request. Non-stream
// requests are request/response; streaming responses (container logs) are opened here and pushed to the
// requester as chunked events it reassembles into the on/off/destroy emitter Api.clients consumes.
//
// It exists for a shell whose engine HTTP must cross a boundary to reach the connection owner. Tauri and Wails
// both dial their native proxy directly (tauri|wails/exec/proxy-request.ts), so neither wires it — see the
// open item in docs/todo.md. Injected deps keep it unit-testable without a shell.

import { COMMAND_PROXY, type CommandProxyResult } from "@/container-client/commandProxyProtocol";
import { createLogger } from "@/logger";

const logger = createLogger("shell.proxy");

interface ForwardedStream {
  destroy: () => void;
  senderId: number | string;
}

export interface CommandProxyBrokerDeps {
  // Ensure the target connection is up before proxying (idempotent) — the renderer also awaits this.
  ensureConnected: (connectionId?: string) => Promise<void>;
  // The target connection's host-client Axios driver (falls back to the primary when id is absent).
  getDriver: (connectionId?: string) => Promise<{ request: (config: any) => Promise<any> }>;
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  // Push a stream event to the window that opened the stream.
  send: (event: any, channel: string, payload: unknown) => void;
  // Only the main app window forwards engine HTTP.
  isAllowedSender: (event: any) => boolean;
  // Stable identity for a sender, so its streams can be reaped when its window closes.
  senderId: (event: any) => number | string;
}

// Axios headers may be an AxiosHeaders instance with methods; keep only primitive entries for IPC.
function toPlainHeaders(headers: any): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export class CommandProxyBroker {
  private counter = 0;
  private readonly streams = new Map<string, ForwardedStream>();

  constructor(private readonly deps: CommandProxyBrokerDeps) {}

  register(): void {
    this.deps.onInvoke(COMMAND_PROXY.request, (event, payload) => this.handleRequest(event, payload));
    this.deps.onMessage(COMMAND_PROXY.streamDestroy, (event, payload) => {
      if (!this.deps.isAllowedSender(event)) {
        return;
      }
      this.destroyStream(payload?.streamId);
    });
  }

  // Reap any streams a (now-closed) window had open, so a closed log view never leaks a live engine stream.
  disposeForSender(senderId: number | string): void {
    for (const [streamId, stream] of this.streams) {
      if (stream.senderId === senderId) {
        stream.destroy();
        this.streams.delete(streamId);
      }
    }
  }

  private async handleRequest(event: any, payload: any): Promise<CommandProxyResult> {
    if (!this.deps.isAllowedSender(event)) {
      logger.warn("rejected forwarded request from unauthorized sender");
      return { stream: false, ok: false, message: "unauthorized" };
    }
    // Route to the connection the renderer addressed (its adapter forwards the owning Connection) so several
    // connections' forwarded HTTP can be served at once; falls back to the primary when the id is absent.
    const connectionId = (payload?.connection as { id?: string } | null | undefined)?.id;
    await this.deps.ensureConnected(connectionId);
    const driver = await this.deps.getDriver(connectionId);
    const req = (payload?.req ?? {}) as Record<string, unknown>;
    if (req.responseType === "stream") {
      return this.openStream(event, driver, req);
    }
    const startedAt = Date.now();
    try {
      const response = await driver.request(req);
      logger.debug("proxy", { method: req.method, url: req.url, status: response?.status, ms: Date.now() - startedAt });
      return {
        stream: false,
        ok: true,
        status: response?.status,
        statusText: response?.statusText,
        headers: toPlainHeaders(response?.headers),
        data: response?.data,
      };
    } catch (error: any) {
      const response = error?.response;
      logger.error(
        "proxy request error",
        { method: req.method, url: req.url, status: response?.status, data: response?.data },
        error?.message ?? error,
      );
      return {
        stream: false,
        ok: false,
        status: response?.status,
        statusText: response?.statusText,
        headers: toPlainHeaders(response?.headers),
        data: response?.data,
        message: error?.message ?? String(error),
      };
    }
  }

  private async openStream(
    event: any,
    driver: { request: (config: any) => Promise<any> },
    req: Record<string, unknown>,
  ): Promise<CommandProxyResult> {
    const response = await driver.request(req);
    const emitter = response?.data;
    if (!emitter || typeof emitter.on !== "function") {
      return { stream: false, ok: false, status: response?.status, message: "stream response had no emitter" };
    }
    this.counter += 1;
    const streamId = `cps-${this.counter}`;
    logger.debug("proxy stream open", { url: req.url, streamId, status: response?.status });
    const send = (type: "data" | "end" | "error", value?: unknown) =>
      this.deps.send(event, COMMAND_PROXY.streamEvent, { streamId, type, payload: value });
    emitter.on("data", (chunk: any) => send("data", typeof chunk === "string" ? chunk : `${chunk}`));
    emitter.on("end", () => {
      send("end");
      this.streams.delete(streamId);
    });
    emitter.on("error", (error: any) => {
      send("error", { message: error?.message ?? String(error) });
      this.streams.delete(streamId);
    });
    this.streams.set(streamId, { destroy: () => emitter.destroy?.(), senderId: this.deps.senderId(event) });
    return { stream: true, streamId, status: response?.status, headers: toPlainHeaders(response?.headers) };
  }

  private destroyStream(streamId?: string): void {
    if (!streamId) {
      return;
    }
    this.streams.get(streamId)?.destroy();
    this.streams.delete(streamId);
  }
}
