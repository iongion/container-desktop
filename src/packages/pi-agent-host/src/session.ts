import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultPackageManager,
  type ExtensionAPI,
  getPackageDir,
  type InlineExtension,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import { createLogger } from "@/logger";
import { createContainerToolsExtension } from "@/pi-agent-host/containerTools";
import { mapAgentEvent, type PiAgentEvent } from "@/pi-agent-host/events";
import { GuiTui } from "@/pi-agent-host/guiTui";
import { createHostRpc } from "@/pi-agent-host/hostRpc";
import { createPermissionGateExtension } from "@/pi-agent-host/permissionGate";
import { runPiCommand } from "@/pi-agent-host/piCommands";
import { buildPiTheme, normalizeAppThemePalette } from "@/pi-agent-host/piTheme";
import { createPluginService } from "@/pi-agent-host/plugins";
import { checkSessionProvider } from "@/pi-agent-host/providerCheck";
import { type PiSessionFacts, sessionContextReport, sessionUsageReport } from "@/pi-agent-host/reports";
import { collectResources } from "@/pi-agent-host/resources";
import type { BridgeSessionHandle } from "@/pi-agent-host/server";
import { replaySessionEntries, sessionWasCompacted } from "@/pi-agent-host/sessionReplay";
import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import { createSystemContextExtension } from "@/pi-agent-host/systemContext";
import { createToolSurfaceRenderer, routeToolSurfaces } from "@/pi-agent-host/toolSurfaces";
import { createGuiUiContext, type PiKeybindings } from "@/pi-agent-host/uiContext";
import { createVirtualTerminal } from "@/pi-agent-host/virtualTerminal";
import { createWebSearchExtension } from "@/pi-agent-host/webSearchTool";
import type { AppThemePalette, BridgeEvent, PiSessionReplacement } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.session");

// The panel the surfaces are painted into, until the renderer reports its own measured width. Wide
// enough that a first frame is not laid out for a phone and then reflowed a beat later.
const DEFAULT_SURFACE_COLUMNS = 100;
const DEFAULT_SURFACE_ROWS = 30;

// One provider id for the gateway. Models are declared against it so pi never reads ~/.pi/auth.json and
// never learns a real key: the gateway container owns the credential.
export const GATEWAY_PROVIDER_ID = "container-desktop-gateway";

// pi's own defaults, mirrored because its ProviderModelConfig requires both numbers even when nobody knows them
// (provider-composer.js: `definition.contextWindow ?? 128000`). Used ONLY so pi has something to compact against —
// never reported to the user as this model's budget.
const PI_FALLBACK_CONTEXT_WINDOW = 128000;
const PI_FALLBACK_MAX_OUTPUT_TOKENS = 4096;

// pi's ProviderConfigInput.streamSimple, kept loose here so the test can inject a canned generator
// without reconstructing pi-ai's Context and Model types.
export type PiStreamFn = (...args: never[]) => AsyncGenerator<unknown>;

// The wire shape pi speaks to the gateway. The gateway proxies bytes, so this has to be the UPSTREAM's shape:
// an OpenAI-completions request can never satisfy Anthropic's /v1/messages endpoint.
export type PiModelApi = "openai-completions" | "anthropic-messages";

const MODEL_APIS: readonly PiModelApi[] = ["openai-completions", "anthropic-messages"];

// Absent ⇒ OpenAI completions, which is what every other provider family speaks.
export function parseModelApi(value: string | undefined): PiModelApi {
  if (!value) return "openai-completions";
  if (!MODEL_APIS.includes(value as PiModelApi)) {
    throw new Error(`CD_MODEL_API must be one of ${MODEL_APIS.join(", ")}`);
  }
  return value as PiModelApi;
}

export interface CreatePiSessionOptions {
  cwd: string;
  agentDir: string;
  gatewayUrl: string;
  // The shared secret between the agent and gateway containers. pi sends it as the provider's bearer
  // token, which is exactly what the gateway authorizes on — the real provider key never comes here.
  gatewayToken: string;
  modelId: string;
  // Which wire shape the upstream behind the gateway speaks. The app derives it from the provider's kind and
  // sends it in the agent's env file; `gatewayUrl` is already the base that shape's client expects.
  modelApi?: PiModelApi;
  // What the PROVIDER said about this model's budget, when it publishes one. Absent means unknown — and unknown is
  // then REPORTED as unknown, rather than as the invented 128000/4096 every model used to be registered with.
  contextWindow?: number;
  maxOutputTokens?: number;
  // The provider's rates in dollars per million tokens, as pi's model config wants them. Absent for a free or
  // unpriced model, where pi's own zeroes are the truth.
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  emit: (event: BridgeEvent) => void;
  streamOverride?: PiStreamFn;
  // The app's `--app-*` colours, so plugin components are painted in the theme the rest of the app is.
  // The renderer re-sends these whenever the engine or light/dark mode changes them.
  themePalette?: Partial<AppThemePalette>;
  // Inline extensions loaded alongside the gateway and the permission gate. The hermetic suite drives
  // the UI surface through one instead of putting a plugin file in the mounted volume.
  extraExtensions?: InlineExtension[];
  // Model-facing prose for the container toolset, keyed by tool name. Required rather than defaulted: the loader
  // that reads it is bundler-specific (containerToolDescriptions.ts), and a session that quietly registered no
  // container tools would look like an agent that simply chose not to use them.
  containerToolDescriptions: Readonly<Record<string, string>>;
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
        api: options.modelApi ?? "openai-completions",
        ...(streamOverride ? { streamSimple: streamOverride as never } : {}),
        models: [
          {
            id: modelId,
            name: modelId,
            reasoning: false,
            input: ["text"],
            // pi multiplies these by the token counts to bill a turn, so all-zero is what made every session report
            // $0.00 whatever it really cost. Zero stays the honest answer for a free model.
            cost: {
              input: options.pricing?.input ?? 0,
              output: options.pricing?.output ?? 0,
              cacheRead: options.pricing?.cacheRead ?? 0,
              cacheWrite: options.pricing?.cacheWrite ?? 0,
            },
            // What the PROVIDER said, falling back to pi's own defaults because its ProviderModelConfig requires both
            // numbers and pi needs them for its compaction maths. The fallback is NOT passed on to the user: the
            // report carries only what the provider actually published, so the panel says "unknown" rather than
            // repeating a guess. This pair used to be hardcoded for every model on every server, which is where the
            // Context panel's "123,904 input tokens" came from while LM Studio had 8192 loaded.
            contextWindow: options.contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW,
            maxTokens: options.maxOutputTokens ?? PI_FALLBACK_MAX_OUTPUT_TOKENS,
          },
        ],
      });
    },
  };

  const rpc = createHostRpc(emit);
  const systemContext = createSystemContextExtension();

  // Settings are file-backed at `agentDir`, which is the named plugin volume: installing a plugin writes its
  // source into `packages` there, so the set survives the session that installed it. `projectTrusted` stays
  // false, so pi refuses project-scoped package storage — nothing is written into the user's workspace.
  //
  // ONE instance for the life of the container, shared by every session it runs and by the plugin package manager.
  // pi would let the factory build a fresh one per cwd; here that would hand the Plugins screen a different
  // settings instance from the session's, and the two would disagree about what is installed.
  const settingsManager = SettingsManager.create(cwd, agentDir);

  // What pi calls to build a session — once at start, and again for every replacement (`/new`, `/resume`, `/clone`,
  // `/import`). Everything above it is fixed for the life of the container; everything in it is per session.
  const createRuntime: CreateAgentSessionRuntimeFactory = async (target) => {
    // pi hands the factory `sessionManager.getCwd()`, which for an imported session is whatever machine wrote the
    // JSONL. This container has exactly one workspace — the folder the app bind-mounted — so a session claiming a
    // different one must fail loudly here rather than run its tools against a path that is not the user's project.
    if (target.cwd !== cwd) {
      throw new Error(`this container serves ${cwd}; the session asked for ${target.cwd}`);
    }
    const services = await createAgentSessionServices({
      cwd,
      agentDir: target.agentDir,
      settingsManager,
      resourceLoaderOptions: {
        extensionFactories: [
          gatewayExtension,
          createPermissionGateExtension(rpc),
          // The container toolset. It registers tools only — each call still passes the permission gate above,
          // because the gate handles every tool_call regardless of who registered the tool.
          createContainerToolsExtension({ rpc, descriptions: options.containerToolDescriptions }),
          // Public web search, performed by the app. Registered unconditionally: the setting it depends on can be
          // turned off mid-session, so the app answers with that as the reason rather than the tool vanishing.
          createWebSearchExtension({ rpc, description: options.containerToolDescriptions[WEB_SEARCH_TOOL_NAME] ?? "" }),
          // The app's project rules and memories. Registered last of the app's own three so its append lands on top
          // of whatever the others contributed to the turn's system prompt. The prose itself outlives every
          // replacement, because the extension holds it and the extension is built once, above.
          systemContext.extension,
          ...(options.extraExtensions ?? []),
        ],
      },
    });
    await services.modelRuntime.setRuntimeApiKey(GATEWAY_PROVIDER_ID, gatewayToken, { allowNetwork: false });

    const model = services.modelRuntime.getModel(GATEWAY_PROVIDER_ID, modelId);
    if (!model) {
      throw new Error(`gateway model ${modelId} was not registered — the provider flush did not happen`);
    }
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: target.sessionManager,
      model,
      ...(target.sessionStartEvent ? { sessionStartEvent: target.sessionStartEvent } : {}),
    });
    return { ...created, services, diagnostics: services.diagnostics };
  };

  // The runtime owns the current session and replaces it IN PROCESS. Adopting it is what makes `/new`, `/resume`,
  // `/clone` and `/import` real here: without it a container could only ever run the session it was started with,
  // and a fresh conversation cost the user their containers, their plugins and the wait to build them again.
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });
  // Which of pi's replacements is in flight, so the app is told why its transcript was reset. pi does not carry the
  // reason into the rebind, and only this host calls a replacement, so it is recorded where the call is made.
  let replacement: PiSessionReplacement = "new";

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
    // Read off the RUNNING session, never a captured one: a replacement brings a new tool runtime, and a renderer
    // resolved against the disposed session would silently stop drawing a plugin's rows.
    getToolDefinition: (name) => runtime.session.getToolDefinition(name),
  });

  // pi only says that a compaction happened, never how much it dropped, so the fact is remembered here and
  // travels with every later report — the app would otherwise keep claiming an untouched history.
  let compacted = false;
  // Whether the APP asked this turn to stop. Held for the rest of the turn rather than cleared on the first event,
  // because pi retries the dying request and reports each attempt.
  let aborting = false;

  // What this session has spent and what it is sending the model, read off pi rather than counted from the events
  // the app happened to see: pi's stats span entries it has since compacted away, which no bridge tally could.
  const readFacts = (): PiSessionFacts => {
    const session = runtime.session;
    const stats = session.getSessionStats();
    return {
      model: modelId,
      systemPrompt: session.systemPrompt,
      activeToolNames: session.getActiveToolNames(),
      tools: session.getAllTools().map(({ name, description }) => ({ name, description })),
      stats: {
        userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages,
        toolCalls: stats.toolCalls,
        tokens: { input: stats.tokens.input, output: stats.tokens.output },
        cost: stats.cost,
        ...(stats.contextUsage
          ? { contextUsage: { tokens: stats.contextUsage.tokens, contextWindow: stats.contextUsage.contextWindow } }
          : {}),
      },
      maxOutputTokens: session.model?.maxTokens ?? 0,
      // Only what the provider published — never pi's fallback, which `model.contextWindow` and `model.maxTokens`
      // would both carry.
      ...(options.contextWindow ? { providerContextWindow: options.contextWindow } : {}),
      ...(options.maxOutputTokens ? { providerMaxOutputTokens: options.maxOutputTokens } : {}),
      compacted,
    };
  };

  const publishReports = () => {
    try {
      const facts = readFacts();
      emit({ type: "usage", usage: sessionUsageReport(facts) });
      emit({ type: "request_context", context: sessionContextReport(facts) });
    } catch (error) {
      // Reporting is observability: a session that cannot describe itself must still answer prompts.
      logger.warn("unable to report the session's usage and context", error);
    }
  };

  // Everything a session needs from this host: the event plumbing and the UI bindings. Applied to the session the
  // runtime built, and applied again to whichever session replaces it — the surfaces, tool renderers and GuiTui are
  // the same objects throughout, so they must be RE-POINTED at the new session, never rebuilt.
  const attach = async (session: AgentSession) => {
    session.subscribe((event) => {
      const piEvent = event as unknown as PiAgentEvent;
      routeToolSurfaces(toolSurfaces, piEvent);
      for (const mapped of mapAgentEvent(piEvent)) {
        // A turn the APP aborted — the user pressed Stop, or rejected a tool call — dies with its in-flight upstream
        // request, and pi reports that as a finished assistant message with stopReason "error" and the transport's
        // own wording ("Connection error."), not as stopReason "aborted". Relaying it would tell the user their
        // assistant broke when in fact it obeyed them, and pi retries first, so they would be told several times.
        if (mapped.type === "error" && aborting) continue;
        emit(mapped);
      }
      if (piEvent.type === "session_compact") compacted = true;
      // After the turn, when the numbers have moved and the tool set for the next one is settled.
      if (piEvent.type === "turn_end" || piEvent.type === "agent_settled") publishReports();
    });

    // `tui` is what the extensions see now: dialogs are answered by the app AND components render, because
    // every one of them is drawn to lines here and painted by an xterm surface in the renderer. A plugin
    // guarding on `mode === "tui"` takes its rich path and gets a surface that works. This is also what emits
    // pi's `session_start`, so it is the point every extension is (re)born at.
    await session.bindExtensions({ uiContext: guiUi.ui, mode: "tui" });
  };

  // What the app is told a session is running against. Read off the live session rather than restated from the
  // options: a resumed conversation can carry a model change pi resolved for itself.
  const modelLabel = (session: AgentSession) => {
    const model = session.model;
    return model ? `${model.provider}/${model.id}` : `${GATEWAY_PROVIDER_ID}/${modelId}`;
  };

  await attach(runtime.session);

  // The surfaces on screen were opened by extensions that are about to become stale, and the tool rows belong to a
  // conversation that is ending. pi runs this synchronously, before the outgoing session is invalidated, which is
  // exactly when a frame can still be retired cleanly.
  runtime.setBeforeSessionInvalidate(() => {
    surfaces.closeAll();
    toolSurfaces.clear();
  });

  // A replacement landed. The app holds a transcript of events, not a view of pi's store, so it is told to drop what
  // it has and is then handed the new session's own entries as the very events it would have seen live.
  runtime.setRebindSession(async (session) => {
    const entries = session.sessionManager.getBranch();
    // Re-derived, never carried over: claiming the predecessor's compaction would tell the user part of THIS
    // conversation is a summary when none of it is.
    compacted = sessionWasCompacted(entries);
    emit({
      type: "session_replaced",
      reason: replacement,
      sessionId: session.sessionId,
      cwd,
      model: modelLabel(session),
    });
    for (const event of replaySessionEntries(entries)) emit(event);
    await attach(session);
    // A replaced session is holding nothing: the replay is history, not a turn in flight.
    emit({ type: "idle" });
    publishReports();
  });

  // Perform one of pi's session replacements, and tell the app why. `aborting` covers the whole call because the
  // teardown aborts whatever turn was running — that abort is this host's, so the transport failure it provokes must
  // not reach the user as a model error.
  const replace = async (reason: PiSessionReplacement, run: () => Promise<{ cancelled: boolean }>) => {
    replacement = reason;
    aborting = true;
    try {
      return await run();
    } finally {
      aborting = false;
    }
  };

  // A second package manager over the same settings and agent dir. pi's resource loader keeps its own for
  // resolution; this one exists so the GUI's install, remove and update run through the manager's public
  // surface, including its progress callback.
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const plugins = createPluginService({ packageManager, settings: settingsManager, emit });

  return {
    // Getters, not values: a replacement changes both, and a handshake answered with the predecessor's id would
    // name a session that no longer exists.
    get sessionId() {
      return runtime.session.sessionId;
    },
    get model() {
      return modelLabel(runtime.session);
    },
    cwd,
    plugins,
    listResources() {
      return collectResources(runtime.services.resourceLoader);
    },
    async reload() {
      await runtime.session.reload();
      // The extensions that owned the open surfaces are gone; their frames would otherwise sit on screen
      // with nothing behind them, taking keys no component reads.
      surfaces.closeAll();
      toolSurfaces.clear();
      emit({ type: "plugins_changed" });
    },
    surfaceInput(surfaceId, data) {
      guiUi.handleSurfaceInput(surfaceId, data);
    },
    surfaceResize(surfaceId, columns) {
      surfaces.resize(surfaceId, columns);
    },
    setSystemContext(text) {
      systemContext.set(text);
    },
    checkProvider() {
      return checkSessionProvider({ gatewayUrl, gatewayToken });
    },
    // One of pi's own commands, by pi's own name. The dispatcher answers with a value, never a throw: the palette
    // shows the reason a command is unavailable here, which is more use than a stack trace.
    runCommand(name, args) {
      return runPiCommand(
        {
          session: runtime.session,
          sessionManager: runtime.session.sessionManager,
          // The session replacements pi performs in process. `AgentSession.sessionManager` above is the live one, so
          // a command reading the tree after a replacement reads the tree it landed in.
          runtime: {
            newSession: () => replace("new", () => runtime.newSession()),
          },
          keybindings: () =>
            Object.entries(getKeybindings().getResolvedBindings()).map(([action, keys]) => ({
              action,
              keys: Array.isArray(keys) ? keys : keys ? [keys] : [],
            })),
          // pi's shipped changelog, read from the installed package rather than restated here.
          changelog: () => readFile(join(getPackageDir(), "CHANGELOG.md"), "utf8"),
        },
        name,
        args,
      );
    },
    setThemePalette(palette) {
      guiUi.applyTheme(buildPiTheme(normalizeAppThemePalette(palette)));
      // Components cache their styled lines, so a new theme only reaches the screen if every open
      // surface is asked again — a stale palette is exactly what makes plugin output look foreign.
      surfaces.invalidateAll();
      toolSurfaces.rerenderAll();
    },
    async prompt(text, streamingBehavior) {
      // A fresh turn is nobody's abort yet: the flag belongs to the turn that was stopped, not to the session.
      aborting = false;
      try {
        await runtime.session.prompt(text, streamingBehavior ? { streamingBehavior } : undefined);
      } catch (error) {
        // A swallowed turn error reads as a hung UI: the transcript just stops. Surface it, then rethrow
        // so the bridge command response fails too.
        logger.error("pi turn failed", error);
        emit({ type: "error", message: (error as Error).message });
        throw error;
      }
    },
    async abort() {
      // Set BEFORE the abort lands, so the failure it causes is already recognised as ours when pi reports it.
      aborting = true;
      await runtime.session.abort();
    },
    settleHostResponse: rpc.settle,
  };
}
