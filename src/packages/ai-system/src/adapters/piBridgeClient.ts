import { createLogger } from "@/logger";
import { decodeEvent, encodeCommand } from "@/pi-bridge/codec";
import {
  type AppThemePalette,
  type BridgeCommand,
  type BridgeEvent,
  type ContributedResources,
  PI_BRIDGE_PROTOCOL_VERSION,
  type PiCommandResult,
  type PiModelRegistration,
  type PiSessionModel,
  type PluginListPayload,
  type PluginScope,
  type SessionProviderCheck,
} from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

const logger = createLogger("ai.piBridgeClient");

// The DOM WebSocket surface this client needs, narrowed so tests drive it without a real socket.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
}

export interface HostResponsePayload {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface PiBridgeClient {
  connect(): Promise<void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  // Answers one host_request. The container correlates by requestId, so a late answer is dropped rather
  // than resolving whatever request came next.
  respond(requestId: string, response: HostResponsePayload): Promise<void>;
  // One keystroke for a pi component, already encoded as the terminal bytes pi's key parser reads.
  surfaceInput(surfaceId: string, data: string): Promise<void>;
  surfaceResize(surfaceId: string, columns: number): Promise<void>;
  // The app's `--app-*` colours, so the container can derive a pi theme that matches the running app.
  setTheme(palette: Partial<AppThemePalette>): Promise<void>;
  // The project's rules and memories, as system prose for the turns that follow. A request rather than
  // fire-and-forget: an agent that silently never received them is the defect this exists to close.
  setSystemContext(text: string): Promise<void>;
  // Plugin management. Unlike the fire-and-forget commands above these are real requests: the caller needs
  // the answer, or needs to know an install failed and why.
  listPlugins(): Promise<PluginListPayload>;
  installPlugin(source: string, scope: PluginScope): Promise<void>;
  removePlugin(source: string, scope: PluginScope): Promise<void>;
  updatePlugins(source?: string): Promise<void>;
  checkPluginUpdates(): Promise<string[]>;
  setPluginEnabled(source: string, enabled: boolean, scope: PluginScope): Promise<void>;
  listResources(): Promise<ContributedResources>;
  // Run one of pi's own commands, under pi's own name. Answers with a value: "not available in this session, and
  // why" is what the palette shows, not an exception.
  runCommand(name: string, args: string): Promise<PiCommandResult>;
  // Ask the SESSION whether it can reach the model. The app's own provider check answers for the app's realm, which
  // is not the one a turn runs in.
  checkProvider(): Promise<SessionProviderCheck>;
  // Hand the session's gateway a renewed credential, through the container that can reach it.
  setGatewayCredential(credential: string): Promise<void>;
  // Point the running session at a model the user picked, with whatever the provider published about it — the app
  // asks, because the gateway forwards completions and not a catalogue. Answers with what pi ended up on, so the
  // caller adopts the switch rather than assuming it. The conversation, the containers and the plugins all survive it.
  selectModel(model: PiModelRegistration): Promise<PiSessionModel>;
  reloadSession(): Promise<void>;
  // pi's `/import`. The JSONL travels as text: the app read it off the HOST, and the container cannot open a host
  // path. The session writes it beside its own sessions and imports it, which replaces the running conversation.
  importSession(fileName: string, contents: string): Promise<void>;
  // Read back a truncated tool's full output. The path comes from the tool result's `details.fullOutputPath`
  // and names a file inside the agent container, which only the host can open.
  readToolOutput(path: string): Promise<{ text: string; truncated: boolean }>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  close(): void;
}

// The container's bridge binds its port a few hundred milliseconds AFTER `podman run --detach` returns, so a
// single-shot connect is a coin flip: the first attempt is reset and the session start fails for a reason that
// has nothing to do with the session. Retry until the port answers, then behave exactly as before.
const CONNECT_ATTEMPTS = 40;
const CONNECT_DELAY_MS = 250;

// A read is answered from memory, so a slow one means something is wrong. An install runs npm or git inside
// the container against a registry, which legitimately takes minutes.
const READ_TIMEOUT_MS = 30_000;
const MUTATION_TIMEOUT_MS = 600_000;

export function createPiBridgeClient(options: {
  url: string;
  token: string;
  socketFactory?: (url: string) => WebSocketLike;
  connectRetry?: { attempts: number; delayMs: number };
}): PiBridgeClient {
  const listeners = new Set<(event: BridgeEvent) => void>();
  let socket: WebSocketLike | undefined;
  const pending = new Map<
    string,
    { settle: (result: unknown) => void; fail: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const fanout = (event: BridgeEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // One bad subscriber must not stop the stream for the others.
        logger.error("bridge listener threw", error);
      }
    }
  };

  const settleResponse = (event: Extract<BridgeEvent, { type: "response" }>) => {
    const waiting = pending.get(event.id);
    if (!waiting) return;
    pending.delete(event.id);
    clearTimeout(waiting.timer);
    if (event.success) waiting.settle(event.result);
    else waiting.fail(new Error(event.error ?? "the agent rejected the command"));
  };

  // A socket that dies mid-install must fail the call, not leave a spinner up until the timeout.
  const failAllPending = (reason: string) => {
    for (const [id, waiting] of [...pending]) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.fail(new Error(reason));
    }
  };

  const request = <T>(command: BridgeCommand, timeoutMs: number): Promise<T> => {
    if (!socket) return Promise.reject(new Error("the agent bridge is not connected"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(command.id);
        reject(new Error(`${command.type} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      pending.set(command.id, { settle: (result) => resolve(result as T), fail: reject, timer });
      socket?.send(encodeCommand(command));
    });
  };

  return {
    connect(): Promise<void> {
      const attempts = options.connectRetry?.attempts ?? CONNECT_ATTEMPTS;
      const delayMs = options.connectRetry?.delayMs ?? CONNECT_DELAY_MS;
      return new Promise<void>((resolve, reject) => {
        let attempt = 0;
        let ready = false;

        const open = () => {
          attempt += 1;
          const created = options.socketFactory
            ? options.socketFactory(options.url)
            : (new WebSocket(options.url) as unknown as WebSocketLike);
          socket = created;
          // One attempt reports one outcome: a refused socket fires both error and close, and each must not
          // schedule its own retry.
          let done = false;
          const failed = (error: Error) => {
            if (ready || done) return;
            done = true;
            if (attempt >= attempts) {
              reject(error);
              return;
            }
            setTimeout(open, delayMs);
          };

          created.onopen = () => {
            created.send(
              encodeCommand({
                id: randomUUID(),
                type: "hello",
                token: options.token,
                protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
              }),
            );
          };
          created.onmessage = (message) => {
            let event: BridgeEvent;
            try {
              event = decodeEvent(String(message.data));
            } catch (error) {
              fanout({ type: "error", message: (error as Error).message });
              return;
            }
            if (event.type === "ready" && !ready) {
              ready = true;
              done = true;
              resolve();
            }
            if (event.type === "response") settleResponse(event);
            fanout(event);
          };
          created.onclose = () => {
            failAllPending("the agent bridge closed");
            failed(new Error("bridge closed before ready"));
          };
          created.onerror = (error) => {
            logger.error("bridge socket error", error);
            failed(new Error("bridge socket error"));
          };
        };

        open();
      });
    },
    async prompt(text: string): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "prompt", text }));
    },
    async abort(): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "abort" }));
    },
    async respond(requestId: string, response: HostResponsePayload): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "host_response", requestId, ...response }));
    },
    async surfaceInput(surfaceId: string, data: string): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "surface_input", surfaceId, data }));
    },
    async surfaceResize(surfaceId: string, columns: number): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "surface_resize", surfaceId, columns }));
    },
    async setTheme(palette: Partial<AppThemePalette>): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "set_theme", palette }));
    },
    setSystemContext(text: string): Promise<void> {
      return request({ id: randomUUID(), type: "set_system_context", text }, READ_TIMEOUT_MS);
    },
    listPlugins(): Promise<PluginListPayload> {
      return request({ id: randomUUID(), type: "plugins_list" }, READ_TIMEOUT_MS);
    },
    installPlugin(source: string, scope: PluginScope): Promise<void> {
      return request({ id: randomUUID(), type: "plugins_install", source, scope }, MUTATION_TIMEOUT_MS);
    },
    removePlugin(source: string, scope: PluginScope): Promise<void> {
      return request({ id: randomUUID(), type: "plugins_remove", source, scope }, MUTATION_TIMEOUT_MS);
    },
    updatePlugins(source?: string): Promise<void> {
      const id = randomUUID();
      return request(
        source ? { id, type: "plugins_update", source } : { id, type: "plugins_update" },
        MUTATION_TIMEOUT_MS,
      );
    },
    checkPluginUpdates(): Promise<string[]> {
      return request({ id: randomUUID(), type: "plugins_check_updates" }, MUTATION_TIMEOUT_MS);
    },
    setPluginEnabled(source: string, enabled: boolean, scope: PluginScope): Promise<void> {
      return request({ id: randomUUID(), type: "plugins_set_enabled", source, enabled, scope }, READ_TIMEOUT_MS);
    },
    listResources(): Promise<ContributedResources> {
      return request({ id: randomUUID(), type: "resources_list" }, READ_TIMEOUT_MS);
    },
    checkProvider(): Promise<SessionProviderCheck> {
      return request({ id: randomUUID(), type: "check_provider" }, READ_TIMEOUT_MS);
    },
    async setGatewayCredential(credential: string): Promise<void> {
      await request({ id: randomUUID(), type: "gateway_credential", credential }, READ_TIMEOUT_MS);
    },
    selectModel(model: PiModelRegistration): Promise<PiSessionModel> {
      // pi swaps the model on the session and writes its own settings — a memory operation, not a turn.
      return request({ id: randomUUID(), type: "model_select", model }, READ_TIMEOUT_MS);
    },
    runCommand(name: string, args: string): Promise<PiCommandResult> {
      // A compaction summarises the whole conversation with the model, so this waits like a mutation, not a read.
      return request({ id: randomUUID(), type: "run_command", name, args }, MUTATION_TIMEOUT_MS);
    },
    reloadSession(): Promise<void> {
      return request({ id: randomUUID(), type: "session_reload" }, MUTATION_TIMEOUT_MS);
    },
    importSession(fileName: string, contents: string): Promise<void> {
      // A mutation timeout: the container writes the file, tears the current session down and builds another over
      // the imported history, which is more than a read's worth of work.
      return request({ id: randomUUID(), type: "session_import", fileName, contents }, MUTATION_TIMEOUT_MS);
    },
    readToolOutput(path: string): Promise<{ text: string; truncated: boolean }> {
      return request({ id: randomUUID(), type: "read_tool_output", path }, READ_TIMEOUT_MS);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      failAllPending("the agent session was stopped");
      socket?.close();
      listeners.clear();
    },
  };
}
