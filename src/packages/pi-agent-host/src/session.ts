import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

import type { KnowledgeEntry } from "@/ai-system/core/ports";
import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import { createLogger } from "@/logger";
import { createContainerToolsExtension } from "@/pi-agent-host/containerTools";
import { mapAgentEvent, type PiAgentEvent } from "@/pi-agent-host/events";
import { GATEWAY_CREDENTIAL_PATH } from "@/pi-agent-host/gateway";
import { GuiTui } from "@/pi-agent-host/guiTui";
import { createHostRpc } from "@/pi-agent-host/hostRpc";
import { createKnowledgeToolExtension, KNOWLEDGE_TOOL_NAME } from "@/pi-agent-host/knowledgeTool";
import { type ModelRegistrations, piModelConfig, withModelRegistration } from "@/pi-agent-host/modelRegistrations";
import { createPermissionGateExtension } from "@/pi-agent-host/permissionGate";
import { runPiCommand } from "@/pi-agent-host/piCommands";
import { buildPiTheme, installGlobalPiTheme, normalizeAppThemePalette } from "@/pi-agent-host/piTheme";
import { createPluginService } from "@/pi-agent-host/plugins";
import { checkSessionProvider } from "@/pi-agent-host/providerCheck";
import { type PiSessionFacts, sessionContextReport, sessionUsageReport } from "@/pi-agent-host/reports";
import { collectResources } from "@/pi-agent-host/resources";
import type { BridgeSessionHandle } from "@/pi-agent-host/server";
import {
  createScopedModels,
  createSessionSettings,
  createSessionTrust,
  createWorkspaceSessions,
} from "@/pi-agent-host/sessionControls";
import { replaySessionEntries, sessionWasCompacted } from "@/pi-agent-host/sessionReplay";
import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import { createSystemContextExtension } from "@/pi-agent-host/systemContext";
import { createToolSurfaceRenderer, routeToolSurfaces } from "@/pi-agent-host/toolSurfaces";
import { createGuiUiContext, type PiKeybindings } from "@/pi-agent-host/uiContext";
import { createVirtualTerminal } from "@/pi-agent-host/virtualTerminal";
import { createWebSearchExtension } from "@/pi-agent-host/webSearchTool";
import { createWorkspaceToolsExtension } from "@/pi-agent-host/workspaceTools";
import type {
  AppThemePalette,
  BridgeEvent,
  PiModelReasoning,
  PiModelRegistration,
  PiSessionModel,
  PiSessionReplacement,
} from "@/pi-bridge/protocol";

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

// The wire shape pi speaks to the gateway. The gateway proxies bytes, so this has to be the UPSTREAM's shape:
// an OpenAI-completions request can never satisfy Anthropic's /v1/messages endpoint.
export type PiModelApi = "openai-completions" | "anthropic-messages";

const MODEL_APIS: readonly PiModelApi[] = ["openai-completions", "anthropic-messages"];

// The name a chosen file is written under inside the container. `basename` alone already refuses a traversal, and
// the rest is trimmed to what a session file may be called: the app picked the file, but a file name is not a
// reason to let anything outside the session directory be written.
export function sanitizeSessionFileName(fileName: string): string {
  const base = basename(fileName)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[.-]+/, "");
  const named = base || "imported.jsonl";
  return named.endsWith(".jsonl") ? named : `${named}.jsonl`;
}

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
  // WHERE that shape is spoken — the upstream's own base URL, which pi's compat detection would have read if the
  // gateway were not standing in front of it (`piUpstreamCompat`). Not a credential: the URL is catalogue data, and
  // nothing in this container can use it without the key the gateway holds.
  upstreamBaseUrl?: string;
  // What the PROVIDER said about this model's budget, when it publishes one. Absent means unknown — and unknown is
  // then REPORTED as unknown, rather than as the invented 128000/4096 every model used to be registered with.
  contextWindow?: number;
  maxOutputTokens?: number;
  // The provider's rates in dollars per million tokens, as pi's model config wants them. Absent for a free or
  // unpriced model, where pi's own zeroes are the truth.
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  // Whether this model reasons, and the efforts it accepts. Absent means nobody published it, and pi then offers no
  // thinking level for the session — which is what the settings drawer says plainly.
  reasoning?: PiModelReasoning;
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
  // Model-facing prose for the WORKSPACE toolset, and the flag that decides whether it exists at all. Present only
  // when the app has a target to run those operations on: a session with no target would otherwise offer the model
  // nine tools that can only ever answer "there is nowhere to do that".
  workspaceToolDescriptions?: Readonly<Record<string, string>>;
  // The built-in troubleshooting entries, searched rather than prompted. Absent leaves the tool unregistered, which
  // is what a session with no bank should look like — the whole point is that the model asks for these on purpose.
  knowledgeEntries?: readonly KnowledgeEntry[];
}

export async function createPiSession(options: CreatePiSessionOptions): Promise<BridgeSessionHandle> {
  const { cwd, agentDir, gatewayUrl, gatewayToken, modelId, emit, streamOverride } = options;

  // The models this session has been pointed at: the one the container was given, plus each one the user has since
  // picked. One gateway reaches one upstream, so every model that upstream serves is reachable — but it is registered
  // when it is chosen, never in advance, because the app's picker reads a catalogue one level at a time and this set
  // exists to follow that, not to mirror a provider's whole listing.
  let registered: ModelRegistrations = new Map([
    [
      modelId,
      {
        id: modelId,
        ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(options.pricing ? { pricing: options.pricing } : {}),
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      },
    ],
  ]);

  // The gateway provider, exactly as pi is to register it. Built rather than written twice because a
  // re-registration is validated ON ITS OWN before pi merges it (provider-composer's validateExtensionProvider), so
  // sending only the models fails with `no "api" specified` — the merge never gets to supply the rest.
  //
  // It reads the CURRENT set each time: a session replacement builds fresh services and runs the extension again, so
  // the conversation that takes over is born knowing every model this container has been pointed at — including the
  // one it is running, which would otherwise not be registered for the session that inherited it.
  const gatewayProviderConfig = () => ({
    // baseUrl is required: the provider composer validates it when defining custom models.
    baseUrl: gatewayUrl,
    apiKey: gatewayToken,
    api: options.modelApi ?? "openai-completions",
    ...(streamOverride ? { streamSimple: streamOverride as never } : {}),
    // Named, not passed by reference: `map` would hand `piModelConfig` the array index as its second argument.
    models: [...registered.values()].map((model) =>
      piModelConfig(model, { baseUrl: options.upstreamBaseUrl, api: options.modelApi }),
    ),
  });

  // The inline extension registers the gateway provider. Its registration is queued by the extension
  // runtime and flushed by createAgentSessionServices — the low-level createAgentSession does NOT flush
  // it, which is why services are built here rather than calling createAgentSession directly.
  const gatewayExtension: InlineExtension = {
    name: "container-desktop-gateway",
    factory: (pi: ExtensionAPI) => {
      pi.registerProvider(GATEWAY_PROVIDER_ID, gatewayProviderConfig());
    },
  };

  const rpc = createHostRpc(emit);
  const systemContext = createSystemContextExtension();

  // Settings are file-backed at `agentDir`, which is the named plugin volume: installing a plugin writes its
  // source into `packages` there, so the set survives the session that installed it. `projectTrusted` starts FALSE
  // and follows the user's own trust decision (`createSessionTrust` below): pi's own default is to trust the
  // project, which would let a project nobody vouched for have packages written into the user's workspace.
  //
  // ONE instance for the life of the container, shared by every session it runs and by the plugin package manager.
  // pi would let the factory build a fresh one per cwd; here that would hand the Plugins screen a different
  // settings instance from the session's, and the two would disagree about what is installed.
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });

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
          // The workspace toolset, and ONLY when the session was given somewhere to run it. Registered here rather
          // than always, because a registered tool is a promise to the model that the operation can happen.
          ...(options.workspaceToolDescriptions
            ? [createWorkspaceToolsExtension({ rpc, descriptions: options.workspaceToolDescriptions })]
            : []),
          // The built-in troubleshooting knowledge, answered inside this container: the entries ship in the image, so
          // this needs neither the app nor a network. Registered as a SEARCH, because the whole bank in every system
          // prompt is context every unrelated turn would pay for and never read.
          ...(options.knowledgeEntries?.length
            ? [
                createKnowledgeToolExtension({
                  entries: options.knowledgeEntries,
                  description: options.containerToolDescriptions[KNOWLEDGE_TOOL_NAME] ?? "",
                }),
              ]
            : []),
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
  // initialised, so a plugin building one would crash on its first render. Initialised with pi's own default
  // first, then replaced by the app's — `installGlobalPiTheme` writes the registry the proxy reads, so pi's
  // components paint in the same colours as everything else the app hands a plugin.
  initTheme();
  const appTheme = buildPiTheme(normalizeAppThemePalette(options.themePalette));
  installGlobalPiTheme(appTheme);

  // The GUI owns the size; the terminal exists so pi's components have the interface they expect, not
  // because anything is drawn through it.
  const virtualTerminal = createVirtualTerminal({ columns: DEFAULT_SURFACE_COLUMNS, rows: DEFAULT_SURFACE_ROWS });
  const surfaces = createSurfaceRegistry({ emit, defaultColumns: DEFAULT_SURFACE_COLUMNS });
  const tui = new GuiTui(virtualTerminal.terminal, () => surfaces.rerenderAll());

  const guiUi = createGuiUiContext({
    rpc,
    tui,
    surfaces,
    theme: appTheme,
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

  // The model the conversation is running against right now. `/model` switches it and a resumed session can carry
  // one pi resolved for itself, so nothing here may restate the id the container was started with.
  const liveModelId = () => runtime.session.model?.id ?? modelId;

  // What this session has spent and what it is sending the model, read off pi rather than counted from the events
  // the app happened to see: pi's stats span entries it has since compacted away, which no bridge tally could.
  const readFacts = (): PiSessionFacts => {
    const session = runtime.session;
    const stats = session.getSessionStats();
    // What the PROVIDER published for the model NOW in force — the start options would still be describing the one
    // the container was born with, which is a different model the moment the user switches.
    const published = registered.get(liveModelId());
    return {
      model: liveModelId(),
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
      ...(published?.contextWindow ? { providerContextWindow: published.contextWindow } : {}),
      ...(published?.maxOutputTokens ? { providerMaxOutputTokens: published.maxOutputTokens } : {}),
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
    // A resumed or imported session can carry a `model_change` entry naming a model this gateway does not register,
    // and pi then falls back to ours WITHOUT failing. Silence there would leave the user believing they are talking
    // to the model the transcript was written with.
    if (runtime.modelFallbackMessage) emit({ type: "error", message: runtime.modelFallbackMessage });
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

  // What pi's own commands act on besides the conversation. Every one reads through the runtime, so a replacement
  // does not leave a control answering for the session that is gone.
  const listWorkspaceSessions = createWorkspaceSessions({
    cwd,
    sessionDir: () => runtime.session.sessionManager.getSessionDir(),
    currentPath: () => runtime.session.sessionFile,
  });
  // The trust decision drives pi's own `projectTrusted`, so a project the user has not trusted cannot have its
  // settings — its packages above all — written into the user's workspace.
  const sessionTrust = createSessionTrust({
    agentDir,
    cwd,
    onDecision: (trusted) => settingsManager.setProjectTrusted(trusted),
  });
  const sessionSettings = createSessionSettings(() => runtime.session);
  const scopedModels = createScopedModels({
    session: () => runtime.session,
    services: () => runtime.services,
    providerId: GATEWAY_PROVIDER_ID,
  });

  // Point the conversation at a model, registering it the first time this session is asked for it. pi swaps the model
  // on the session, so the turns, the containers and the plugins are all untouched — this is why a model change no
  // longer costs the user their conversation.
  //
  // Whatever the app knows about the model travels with the request, because only the app can ask the provider. An id
  // this container has not heard of is adopted rather than refused: the user picked it out of the provider's own
  // listing, which the app read and this container cannot.
  const selectModel = async (model: PiModelRegistration): Promise<PiSessionModel> => {
    registered = withModelRegistration(registered, model);
    // The re-registration carries the WHOLE provider config: pi validates an incoming registration on its own before
    // merging it (validateExtensionProvider), so sending only the models fails with `no "api" specified`.
    runtime.services.modelRuntime.registerProvider(GATEWAY_PROVIDER_ID, gatewayProviderConfig());
    const chosen = runtime.services.modelRuntime.getModel(GATEWAY_PROVIDER_ID, model.id);
    if (!chosen) throw new Error(`gateway model ${model.id} was not registered — the provider flush did not happen`);
    await runtime.session.setModel(chosen);
    // Both reports describe the model that is answering, so a switch that did not republish them would leave the
    // panels describing the model of the last turn.
    publishReports();
    return { provider: chosen.provider, id: chosen.id };
  };

  // The JSONL the app read off the HOST filesystem, written where pi's importer can open it. It lands beside the
  // sessions rather than in the workspace: an import is not a change to the user's project.
  const importSession = async (fileName: string, contents: string) => {
    const target = join(runtime.session.sessionManager.getSessionDir(), sanitizeSessionFileName(fileName));
    await writeFile(target, contents, "utf8");
    const { cancelled } = await replace("import", () => runtime.importFromJsonl(target, cwd));
    if (cancelled) throw new Error("an extension cancelled the import");
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
    // The app renewed an expiring sign-in and the gateway is still signing with the old access token. Signed with the
    // bridge token, like every other call this container makes to the gateway — the real credential is the gateway's
    // alone, and this hands it the new one without restarting the pair.
    async setGatewayCredential(credential: string) {
      const url = `${gatewayUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}${GATEWAY_CREDENTIAL_PATH}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${gatewayToken}`, "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      if (!response.ok) throw new Error(`the gateway refused the renewed credential: HTTP ${response.status}`);
    },
    selectModel,
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
            clone: (entryId) => replace("fork", () => runtime.fork(entryId, { position: "at" })),
            // The cwd override is not optional: pi opens the file, reads the cwd its header records, and refuses a
            // session whose directory does not exist here. This container has one workspace, and it is this one.
            switchSession: (path) => replace("resume", () => runtime.switchSession(path, { cwdOverride: cwd })),
          },
          listSessions: () => listWorkspaceSessions(),
          trust: sessionTrust,
          settings: sessionSettings,
          models: scopedModels,
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
    importSession,
    setThemePalette(palette) {
      const next = buildPiTheme(normalizeAppThemePalette(palette));
      guiUi.applyTheme(next);
      // The same theme in both places pi reads one from: what the app hands a plugin factory, and the global its
      // own components resolve. Updating only the first is what left pi's Markdown on the palette it started with.
      installGlobalPiTheme(next);
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
