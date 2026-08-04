import type { HostResponse } from "@/pi-agent-host/hostRpc";
import type { PluginService } from "@/pi-agent-host/plugins";
import { readToolOutput } from "@/pi-agent-host/toolOutput";
import { decodeCommand, encodeEvent } from "@/pi-bridge/codec";
import {
  type AppThemePalette,
  type BridgeCommand,
  type BridgeEvent,
  type ContributedResources,
  PI_BRIDGE_PROTOCOL_VERSION,
  type PiCommandResult,
  type PiModelRegistration,
  type PiSessionModel,
  type SessionProviderCheck,
} from "@/pi-bridge/protocol";

export interface BridgeConnection {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export interface BridgeSessionHandle {
  sessionId: string;
  cwd: string;
  model?: string;
  prompt(text: string, streamingBehavior?: "steer" | "followUp"): Promise<void>;
  abort(): Promise<void>;
  settleHostResponse(requestId: string, response: HostResponse): void;
  surfaceInput(surfaceId: string, data: string): void;
  surfaceResize(surfaceId: string, columns: number): void;
  setThemePalette(palette: Partial<AppThemePalette>): void;
  // The app's project rules and memories, appended to the system prompt of every turn that follows.
  setSystemContext(text: string): void;
  // One of pi's own slash commands, by pi's name.
  runCommand(name: string, args: string): Promise<PiCommandResult>;
  // pi's `/import`. The app owns the file dialog and the host filesystem, so the JSONL arrives as text and the
  // session writes it where pi's importer can open it.
  importSession(fileName: string, contents: string): Promise<void>;
  // Whether this session can reach the model, probed through the gateway from in here.
  checkProvider(): Promise<SessionProviderCheck>;
  // Every model of the session's provider, as the app discovered them. The whole set: one the provider no longer
  // serves stops being offered, and what was already learned about the others is kept.
  registerModels(models: PiModelRegistration[]): void;
  // Point the running session at one of them, in place. Answers with what pi ended up on rather than an echo.
  selectModel(model: PiModelRegistration): Promise<PiSessionModel>;
  plugins: PluginService;
  listResources(): ContributedResources;
  // pi's own reload: settings, resources and the tool runtime, keeping the UI bindings. What makes a
  // freshly installed plugin live without restarting the container.
  reload(): Promise<void>;
}

export interface AttachedBridgeConnection {
  handleFrame(raw: string): Promise<void>;
  emit(event: BridgeEvent): void;
}

// The correlation id of a frame the codec refused. Read leniently and on purpose: the frame is already known to be
// unusable, and the only question left is whether someone is waiting on an answer to it.
function pendingId(raw: string): string | undefined {
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function attachBridgeConnection(
  connection: BridgeConnection,
  options: { token: string; session: BridgeSessionHandle },
): AttachedBridgeConnection {
  const { token, session } = options;
  let greeted = false;

  // Before the handshake only protocol-level frames may leave: agent output must not reach an
  // unauthenticated peer.
  const emit = (event: BridgeEvent) => {
    if (!greeted && event.type !== "error" && event.type !== "response") return;
    connection.send(encodeEvent(event));
  };
  const respond = (id: string, success: boolean, error?: string, result?: unknown) => {
    if (error) {
      connection.send(encodeEvent({ type: "response", id, success, error }));
      return;
    }
    connection.send(
      encodeEvent(result === undefined ? { type: "response", id, success } : { type: "response", id, success, result }),
    );
  };

  const handshake = (command: Extract<BridgeCommand, { type: "hello" }>) => {
    if (command.token !== token) {
      connection.close(4401, "unauthorized");
      return;
    }
    if (command.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
      connection.close(4426, "protocol version mismatch");
      return;
    }
    greeted = true;
    respond(command.id, true);
    emit({
      type: "ready",
      protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      cwd: session.cwd,
      model: session.model,
    });
  };

  // A command that answers with data returns it; the rest return undefined and the response carries no result.
  const dispatch = async (command: BridgeCommand): Promise<unknown> => {
    switch (command.type) {
      case "prompt":
        await session.prompt(command.text, command.streamingBehavior);
        return;
      case "abort":
        await session.abort();
        return;
      case "host_response":
        session.settleHostResponse(command.requestId, {
          ok: command.ok,
          value: command.value,
          error: command.error,
        });
        return;
      case "surface_input":
        session.surfaceInput(command.surfaceId, command.data);
        return;
      case "surface_resize":
        session.surfaceResize(command.surfaceId, command.columns);
        return;
      case "set_theme":
        session.setThemePalette(command.palette);
        return;
      case "set_system_context":
        session.setSystemContext(command.text);
        return;
      case "run_command":
        return session.runCommand(command.name, command.args);
      case "check_provider":
        return session.checkProvider();
      case "plugins_list":
        return session.plugins.list();
      case "plugins_install":
        await session.plugins.install(command.source, command.scope);
        return;
      case "plugins_remove":
        await session.plugins.remove(command.source, command.scope);
        return;
      case "plugins_update":
        await session.plugins.update(command.source);
        return;
      case "plugins_check_updates":
        return session.plugins.checkUpdates();
      case "plugins_set_enabled":
        await session.plugins.setEnabled(command.source, command.enabled, command.scope);
        return;
      case "resources_list":
        return session.listResources();
      case "session_reload":
        await session.reload();
        return;
      case "read_tool_output":
        return readToolOutput(command.path);
      case "session_import":
        await session.importSession(command.fileName, command.contents);
        return;
      case "models_register":
        session.registerModels(command.models);
        return;
      case "model_select":
        return session.selectModel(command.model);
      case "hello":
        return;
    }
  };

  return {
    emit,
    async handleFrame(raw: string): Promise<void> {
      let command: BridgeCommand;
      try {
        command = decodeCommand(raw);
      } catch (error) {
        const message = (error as Error).message;
        connection.send(encodeEvent({ type: "error", message }));
        // A command this host does not know — an app newer than its container image — must not leave the caller's
        // request pending until its timeout, which reads as a hung session rather than a version mismatch.
        const id = pendingId(raw);
        if (id) respond(id, false, message);
        return;
      }
      if (command.type === "hello") {
        handshake(command);
        return;
      }
      if (!greeted) {
        respond(command.id, false, "handshake required");
        return;
      }
      try {
        const result = await dispatch(command);
        respond(command.id, true, undefined, result);
      } catch (error) {
        respond(command.id, false, (error as Error).message);
      }
    },
  };
}
