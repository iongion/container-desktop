import {
  type AttachedBridgeConnection,
  attachBridgeChannel,
  type BridgeConnection,
} from "@/pi-agent-host/bridgeChannel";
import type { HostResponse } from "@/pi-agent-host/hostRpc";
import type { PluginService } from "@/pi-agent-host/plugins";
import type { ProviderProxy } from "@/pi-agent-host/providerProxy";
import { readToolOutput } from "@/pi-agent-host/toolOutput";
import {
  type AppThemePalette,
  type BridgeCommand,
  type ContributedResources,
  PI_BRIDGE_PROTOCOL_VERSION,
  type PiCommandResult,
  type PiModelRegistration,
  type PiSessionModel,
  type SessionProviderCheck,
} from "@/pi-bridge/protocol";

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
  // Whether this session can reach the model, probed from in here through the proxy the turns themselves use.
  checkProvider(): Promise<SessionProviderCheck>;
  // Point the running session at a model, in place, registering it the first time this session is asked for it.
  // Answers with what pi ended up on rather than an echo.
  selectModel(model: PiModelRegistration): Promise<PiSessionModel>;
  plugins: PluginService;
  listResources(): ContributedResources;
  // pi's own reload: settings, resources and the tool runtime, keeping the UI bindings. What makes a
  // freshly installed plugin live without restarting the container.
  reload(): Promise<void>;
}

export function attachBridgeConnection(
  connection: BridgeConnection,
  // The proxy is the CONTAINER's, not this connection's: it binds a port once and answers every session the container
  // runs. This connection is only how its frames travel.
  options: { token: string; session: BridgeSessionHandle; providerProxy: ProviderProxy },
): AttachedBridgeConnection {
  const { token, session } = options;

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
      case "provider_stream":
        options.providerProxy.deliver(command.requestId, command.event);
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
      case "session_import":
        await session.importSession(command.fileName, command.contents);
        return;
      case "model_select":
        return session.selectModel(command.model);
      case "hello":
        return;
    }
  };

  return attachBridgeChannel(connection, {
    token,
    dispatch,
    greeting: () => ({
      type: "ready",
      protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      cwd: session.cwd,
      model: session.model,
    }),
  });
}
