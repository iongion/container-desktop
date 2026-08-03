import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ExtensionAPI,
  type InlineExtension,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

import { createLogger } from "@/logger";
import { mapAgentEvent, type PiAgentEvent } from "@/pi-agent-host/events";
import { GuiTui } from "@/pi-agent-host/guiTui";
import { createHostRpc } from "@/pi-agent-host/hostRpc";
import { createPermissionGateExtension } from "@/pi-agent-host/permissionGate";
import { buildPiTheme, normalizeAppThemePalette } from "@/pi-agent-host/piTheme";
import type { BridgeSessionHandle } from "@/pi-agent-host/server";
import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import { createToolSurfaceRenderer, routeToolSurfaces } from "@/pi-agent-host/toolSurfaces";
import { createGuiUiContext, type PiKeybindings } from "@/pi-agent-host/uiContext";
import { createVirtualTerminal } from "@/pi-agent-host/virtualTerminal";
import type { AppThemePalette, BridgeEvent } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.session");

// The panel the surfaces are painted into, until the renderer reports its own measured width. Wide
// enough that a first frame is not laid out for a phone and then reflowed a beat later.
const DEFAULT_SURFACE_COLUMNS = 100;
const DEFAULT_SURFACE_ROWS = 30;

// One provider id for the gateway. Models are declared against it so pi never reads ~/.pi/auth.json and
// never learns a real key: the gateway container owns the credential.
export const GATEWAY_PROVIDER_ID = "container-desktop-gateway";

// pi's ProviderConfigInput.streamSimple, kept loose here so the test can inject a canned generator
// without reconstructing pi-ai's Context and Model types.
export type PiStreamFn = (...args: never[]) => AsyncGenerator<unknown>;

export interface CreatePiSessionOptions {
  cwd: string;
  agentDir: string;
  gatewayUrl: string;
  // The shared secret between the agent and gateway containers. pi sends it as the provider's bearer
  // token, which is exactly what the gateway authorizes on — the real provider key never comes here.
  gatewayToken: string;
  modelId: string;
  emit: (event: BridgeEvent) => void;
  streamOverride?: PiStreamFn;
  // The app's `--app-*` colours, so plugin components are painted in the theme the rest of the app is.
  // The renderer re-sends these whenever the engine or light/dark mode changes them.
  themePalette?: Partial<AppThemePalette>;
  // Inline extensions loaded alongside the gateway and the permission gate. The hermetic suite drives
  // the UI surface through one instead of putting a plugin file in the mounted volume.
  extraExtensions?: InlineExtension[];
}

export async function createPiSession(options: CreatePiSessionOptions): Promise<BridgeSessionHandle> {
  const { cwd, agentDir, gatewayUrl, gatewayToken, modelId, emit, streamOverride } = options;

  // The inline extension registers the gateway provider. Its registration is queued by the extension
  // runtime and flushed by createAgentSessionServices — the low-level createAgentSession does NOT flush
  // it, which is why services are built here rather than calling createAgentSession directly.
  const gatewayExtension: InlineExtension = {
    name: "container-desktop-gateway",
    factory: (pi: ExtensionAPI) => {
      pi.registerProvider(GATEWAY_PROVIDER_ID, {
        // baseUrl is required: the provider composer validates it when defining custom models.
        baseUrl: gatewayUrl,
        apiKey: gatewayToken,
        api: "openai-completions",
        ...(streamOverride ? { streamSimple: streamOverride as never } : {}),
        models: [
          {
            id: modelId,
            name: modelId,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });
    },
  };

  const rpc = createHostRpc(emit);

  // In-memory settings: the agent container has no user settings file to honour, and this keeps the
  // session from writing one into the mounted plugin volume.
  const settingsManager = SettingsManager.inMemory({});
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      extensionFactories: [gatewayExtension, createPermissionGateExtension(rpc), ...(options.extraExtensions ?? [])],
    },
  });
  await services.modelRuntime.setRuntimeApiKey(GATEWAY_PROVIDER_ID, gatewayToken, { allowNetwork: false });

  const model = services.modelRuntime.getModel(GATEWAY_PROVIDER_ID, modelId);
  if (!model) {
    throw new Error(`gateway model ${modelId} was not registered — the provider flush did not happen`);
  }

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd),
    model,
  });

  // pi's own components (Markdown, SelectList, Editor) read a module-global theme that throws until it is
  // initialised, so a plugin building one would crash on its first render. There is no public way to make
  // that global the app's derived theme — `setThemeInstance` is not exported — so it stays pi's built-in
  // while everything the app hands a plugin carries the app's colours.
  initTheme();

  // The GUI owns the size; the terminal exists so pi's components have the interface they expect, not
  // because anything is drawn through it.
  const virtualTerminal = createVirtualTerminal({ columns: DEFAULT_SURFACE_COLUMNS, rows: DEFAULT_SURFACE_ROWS });
  const surfaces = createSurfaceRegistry({ emit, defaultColumns: DEFAULT_SURFACE_COLUMNS });
  const tui = new GuiTui(virtualTerminal.terminal, () => surfaces.rerenderAll());

  const guiUi = createGuiUiContext({
    rpc,
    tui,
    surfaces,
    theme: buildPiTheme(normalizeAppThemePalette(options.themePalette)),
    keybindings: getKeybindings() as unknown as PiKeybindings,
  });

  // A component that writes straight to the terminal, or asks it for input, still lands on the focused
  // surface — pi's own TUI routes it the same way.
  virtualTerminal.terminal.start(
    (data) => {
      const focused = surfaces.focusedSurfaceId();
      if (focused) guiUi.handleSurfaceInput(focused, data);
    },
    () => surfaces.resizeAll(virtualTerminal.terminal.columns),
  );

  const toolSurfaces = createToolSurfaceRenderer({
    surfaces,
    cwd,
    getTheme: () => guiUi.ui.theme,
    getToolsExpanded: guiUi.getToolsExpanded,
    getToolDefinition: (name) => session.getToolDefinition(name),
  });

  session.subscribe((event) => {
    const piEvent = event as unknown as PiAgentEvent;
    routeToolSurfaces(toolSurfaces, piEvent);
    for (const mapped of mapAgentEvent(piEvent)) emit(mapped);
  });

  // `tui` is what the extensions see now: dialogs are answered by the app AND components render, because
  // every one of them is drawn to lines here and painted by an xterm surface in the renderer. A plugin
  // guarding on `mode === "tui"` takes its rich path and gets a surface that works.
  await session.bindExtensions({ uiContext: guiUi.ui, mode: "tui" });

  return {
    sessionId: session.sessionId,
    cwd,
    model: `${GATEWAY_PROVIDER_ID}/${modelId}`,
    surfaceInput(surfaceId, data) {
      guiUi.handleSurfaceInput(surfaceId, data);
    },
    surfaceResize(surfaceId, columns) {
      surfaces.resize(surfaceId, columns);
    },
    setThemePalette(palette) {
      guiUi.applyTheme(buildPiTheme(normalizeAppThemePalette(palette)));
      // Components cache their styled lines, so a new theme only reaches the screen if every open
      // surface is asked again — a stale palette is exactly what makes plugin output look foreign.
      surfaces.invalidateAll();
      toolSurfaces.rerenderAll();
    },
    async prompt(text, streamingBehavior) {
      try {
        await session.prompt(text, streamingBehavior ? { streamingBehavior } : undefined);
      } catch (error) {
        // A swallowed turn error reads as a hung UI: the transcript just stops. Surface it, then rethrow
        // so the bridge command response fails too.
        logger.error("pi turn failed", error);
        emit({ type: "error", message: (error as Error).message });
        throw error;
      }
    },
    async abort() {
      await session.abort();
    },
    settleHostResponse: rpc.settle,
  };
}
