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
        connection.send(encodeEvent({ type: "error", message: (error as Error).message }));
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
