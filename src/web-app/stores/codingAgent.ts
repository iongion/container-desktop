// Session state for the containerized pi coding agent: it owns the container pair, the bridge client and
// the projected transcript. The provider key travels from settings into the gateway's private env file and
// is never held in this store's state.
import { Intent } from "@blueprintjs/core";
import { create } from "zustand";

import type { ModelPricing } from "@/ai-system/adapters/modelWindow";
import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import {
  GATEWAY_PORT_IN_IMAGE,
  gatewayUpstreamUrl,
  pickHostPort,
  reapOrphanPiAgentSessions,
  startPiAgentSession,
  stopPiAgentSession,
} from "@/ai-system/adapters/piAgentContainer";
import {
  createPiBridgeClient,
  type HostResponsePayload,
  type PiBridgeClient,
} from "@/ai-system/adapters/piBridgeClient";
import { bindSessionWorkspace } from "@/ai-system/adapters/sessionWorkspace";
import {
  type AIPermissionMode,
  cachedVerdict,
  type PermissionRule,
  permissionKey,
  toolRule,
} from "@/ai-system/core/permissions";
import { decidePiToolCall, piPermissionContext } from "@/ai-system/core/piApprovals";
import { emptyPiThreadView, type PiThreadViewSession, projectPiThreadView } from "@/ai-system/core/piThreadView";
import type { ProjectContextSnapshot } from "@/ai-system/core/projectContext";
import type { ProviderKind } from "@/ai-system/core/providers";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import type { AIAuthSettings } from "@/ai-system/core/types";
import { type ChromePatch, classifyHostRequest, type PendingUiRequest } from "@/ai-system/core/uiRequests";
import { isMockMode } from "@/container-client/mock/mode";
import { t } from "@/i18n";
import { createLogger } from "@/logger";
import { agentImageTag } from "@/pi-bridge/image";
import type {
  BridgeEvent,
  ContributedResources,
  EngineOpResult,
  PiCommandResult,
  SessionProviderCheck,
  WebSearchAnswer,
} from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";
import { connectedConnections } from "@/web-app/components/ConnectionSelect.logic";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { applySurfaceEvent, type CodingAgentSurfaces, noSurfaces } from "@/web-app/stores/codingAgentSurfaces";
import { composeSessionSystemContext, type SessionSystemContext } from "@/web-app/stores/codingAgentSystemContext";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import { readAppPiThemePalette } from "@/web-app/themes/appPiTheme";

const logger = createLogger("web-app.codingAgent");

type HostRequestEvent = Extract<BridgeEvent, { type: "host_request" }>;

// Session UI an extension drives outside the transcript: footer statuses, composer widgets, the window title
// and a composer draft. Kept apart from the ThreadView so a status update never reads as model output.
export interface CodingAgentChrome {
  statuses: Record<string, string>;
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  title?: string;
  // The composer owns its own draft, so a replacement is delivered as a value plus a sequence: the same text
  // set twice must still apply twice.
  editorDraft?: { text: string; seq: number };
}

export function emptyCodingAgentChrome(): CodingAgentChrome {
  return { statuses: {}, widgets: {} };
}

const NOTIFY_INTENT = {
  info: Intent.PRIMARY,
  warning: Intent.WARNING,
  error: Intent.DANGER,
} as const;

function mergeChrome(chrome: CodingAgentChrome, patch: ChromePatch): CodingAgentChrome {
  const next: CodingAgentChrome = { ...chrome };
  if (patch.statuses) {
    const statuses = { ...chrome.statuses };
    for (const [key, value] of Object.entries(patch.statuses)) {
      if (value === undefined) delete statuses[key];
      else statuses[key] = value;
    }
    next.statuses = statuses;
  }
  if (patch.widgets) {
    const widgets = { ...chrome.widgets };
    for (const [key, value] of Object.entries(patch.widgets)) {
      if (value === undefined) delete widgets[key];
      else widgets[key] = value;
    }
    next.widgets = widgets;
  }
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.editorText !== undefined) {
    next.editorDraft = { text: patch.editorText, seq: (chrome.editorDraft?.seq ?? 0) + 1 };
  }
  return next;
}

function permissionMode(): AIPermissionMode {
  return useAppStore.getState().userSettings.ai?.permissionMode ?? "ask";
}

// The remembered allow/reject record lives behind the AI broker. Reading it fails open to "nothing
// remembered", which means the user is asked — the safe direction.
async function rememberedVerdict(rule: PermissionRule) {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) return undefined;
  try {
    const snapshot = await bridge.listPermissions();
    return cachedVerdict(snapshot, permissionKey(rule));
  } catch (error) {
    logger.warn("unable to read the AI permissions cache", error);
    return undefined;
  }
}

// A rejection has to stop the agent, not just answer it. pi hands the block back to the model as a tool error
// and the model retries the same command straight away — measured against a real model, that turns one "no"
// into an approval card every second. Aborting makes one "no" mean stop, and the user can then steer.
async function stopAfterRejection(client: PiBridgeClient | undefined): Promise<void> {
  try {
    await client?.abort();
  } catch (error) {
    // The rejection itself already reached the container; a failed abort must not surface as a failed answer.
    logger.error("unable to stop the agent after a rejection", error);
  }
}

// Perform one container operation for the agent, through the AI bridge — which is where engineOps is bound to the
// live engine service. Never throws: the container is blocked on this answer, so a failure has to come back as a
// reason the model can act on.
async function performEngineOp(
  request: { op: string; args: Record<string, unknown> },
  defaultConnectionId?: string,
): Promise<EngineOpResult> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) return { ok: false, error: "the app's AI bridge is unavailable" };
  try {
    return await bridge.runEngineOp({ op: request.op, args: request.args, defaultConnectionId });
  } catch (error) {
    logger.error("a container operation failed", request.op, error);
    return { ok: false, error: (error as Error).message };
  }
}

// Run one public-web query for the agent, through the AI bridge — which is where the address-pinned fetch and the
// user's own web-search switch live. Never throws: the container is blocked on this answer, and "you have it turned
// off" is a reason the model should read rather than a broken response.
async function performWebSearch(query: string): Promise<WebSearchAnswer> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) return { ok: false, error: "the app's AI bridge is unavailable" };
  try {
    const { text } = await bridge.runWebSearch(query);
    return { ok: true, text };
  } catch (error) {
    logger.warn("a web search failed or was refused", error);
    return { ok: false, error: (error as Error).message };
  }
}

// The project's rules and memories, read through the AI bridge — the same snapshot the Project context panel
// shows. Absent means "could not be read": the caller keeps whatever the session already has rather than
// replacing a good context with an empty one over a transient failure.
async function readProjectContext(): Promise<ProjectContextSnapshot | undefined> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) return undefined;
  try {
    return await bridge.getProjectContext();
  } catch (error) {
    logger.warn("unable to read the project context", error);
    return undefined;
  }
}

// A rule needs the session's workspace and connection to be scoped, so there is nothing to remember before a
// session exists.
function approvalRule(
  state: Pick<CodingAgentState, "spec" | "connectionId">,
  toolName: string,
  args: unknown,
): PermissionRule | undefined {
  if (!state.spec || !state.connectionId) return undefined;
  return toolRule(
    piPermissionContext({ workspacePath: state.spec.workspacePath, connectionId: state.connectionId }),
    toolName,
    args,
  );
}

// Persisting the user's decision in "remember" mode. The card carries the tool and the exact arguments that
// were asked about, so the rule is rebuilt from the timeline rather than tracked in a second place.
async function rememberVerdict(state: CodingAgentState, approvalId: string, allow: boolean): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  const item = state.view.timeline.find((entry) => entry.kind === "approval" && entry.approvalId === approvalId);
  if (!bridge || !item || item.kind !== "approval") return;
  const rule = approvalRule(state, item.tool, item.args);
  if (!rule) return;
  try {
    await bridge.addPermission(allow ? "allowed" : "blocked", rule);
  } catch (error) {
    // The decision still reached the container; only remembering it failed. Say so instead of pretending.
    logger.error("unable to remember the AI permission decision", error);
    Notification.show({ message: (error as Error).message, intent: Intent.WARNING });
  }
}

// One skill invocation, resolved and rendered host-side by the broker. The transcript shows the command the
// user typed; the model receives the whole rendered body.
export interface SkillSubmission {
  prompt: string;
  displayContent: string;
  // The skill's declared `allowed-tools`. Enforced here rather than inside pi: the app already answers every
  // tool call, so the narrowing lands at the boundary that can actually refuse one.
  allowedTools?: string[];
  // The skill came from a source the user has not vouched for, so its instructions are untrusted content for
  // the duration of the turn.
  initialTaint?: boolean;
}

// What a skill narrowed the turn to, held only while that turn runs.
export interface ActiveSkillScope {
  allowedTools?: Set<string>;
  tainted: boolean;
}

// What the projector cannot read off a bridge event: which connection this session runs on, which configured
// provider answers it, the permission mode in force, and the project sources the app itself put in the prompt.
function viewSession(state: CodingAgentState): PiThreadViewSession {
  return {
    connectionId: state.connectionId,
    ...(state.lastStart?.providerId ? { providerId: state.lastStart.providerId } : {}),
    permissionMode: permissionMode(),
    ...(state.systemContext ? { contextSources: state.systemContext.sources } : {}),
  };
}

// Whether this turn is running on instructions the app did not author: a skill from an untrusted source, the
// project's own rules and memories, or a page the agent just read off the public web. Each means a remembered allow
// is not honoured, so the user sees the call that untrusted text asked for.
function turnTainted(state: Pick<CodingAgentState, "activeSkill" | "systemContext" | "turnReadPublicWeb">): boolean {
  return !!(state.activeSkill?.tainted || state.systemContext?.tainted || state.turnReadPublicWeb);
}

export interface StartCodingAgentOptions {
  connectionId: string;
  workspacePath: string;
  modelId: string;
  upstreamBaseUrl: string;
  appVersion: string;
  // Which configured AI provider the endpoint came from. Recorded so the session can name its inference source —
  // and it is what makes the HOST compose the gateway's env file from the OS keychain, which is the only route a
  // credential ever takes. Absent means a keyless endpoint, and there is no option here to pass a key: the renderer
  // does not hold one.
  providerId?: string;
  // The provider's kind and connection auth, resolved from settings by the start form. Optional so a caller that
  // only holds a keyless endpoint keeps working on the OpenAI-shaped default.
  providerKind?: ProviderKind;
  upstreamAuth?: AIAuthSettings;
  scope?: string;
  egress?: boolean;
}

export interface CodingAgentState {
  status: "idle" | "starting" | "ready" | "error";
  view: ThreadView;
  startLog: string[];
  error?: string;
  spec?: PiAgentSessionSpec;
  // Kept next to the spec so stop() tears the pair down on the connection start() used.
  connectionId?: string;
  client?: PiBridgeClient;
  chrome: CodingAgentChrome;
  // pi components, painted as ANSI line frames. Separate from the chrome because they are drawn, not
  // described: the app has no say in what a plugin's component looks like, only where it goes.
  surfaces: CodingAgentSurfaces;
  // The one blocking dialog an extension is waiting on. pi's dialogs are modal by nature — the agent is
  // parked until answered — so a single slot is the honest model.
  pendingDialog?: PendingUiRequest;
  // Container operations whose approval card is still on screen. Unlike a pi tool — which pi runs once the gate
  // says yes — the app performs these itself, so the request has to be held until the user answers.
  pendingEngineOps: Record<string, { op: string; args: Record<string, unknown> }>;
  // What the loaded plugins contribute, for the composer's slash-command palette. Read once the session is
  // ready and again whenever the installed set changes.
  resources: ContributedResources;
  // The narrowing the running skill asked for, cleared when its turn ends.
  activeSkill?: ActiveSkillScope;
  // This turn has read a page off the public web, so it is carrying content anyone could have published. Cleared
  // with the skill scope when the turn ends.
  turnReadPublicWeb: boolean;
  // What this session was last told about the project's rules and memories. Held because the container cannot be
  // asked what it has, because the taint has to outlive the turn that delivered it, and because an unchanged
  // context is not worth re-sending.
  systemContext?: SessionSystemContext;
  // What this session was started with, so it can be started again identically. A pi session IS the
  // conversation, so "start a fresh conversation" can only mean starting a fresh session.
  lastStart?: StartCodingAgentOptions;
  start(options: StartCodingAgentOptions): Promise<void>;
  submit(text: string): Promise<void>;
  submitSkill(input: SkillSubmission): Promise<void>;
  stop(): Promise<void>;
  // Tear the container pair down and start an identical one. What `/quit` followed by starting again does, and the
  // only route back when nothing is running.
  restart(): Promise<void>;
  // A fresh conversation on the SAME containers, plugins and workspace: pi's own runtime replaces the session in
  // process, so this costs neither the image build nor the plugin load. Falls back to bringing the pair up when
  // there is no session to replace.
  newConversation(): Promise<void>;
  // Stop the RUNNING TURN and leave the session up. Distinct from stop(), which removes the container pair:
  // a user who asks to stop generating does not mean "throw the workspace away".
  abortTurn(): Promise<void>;
  applyBridgeEvent(event: BridgeEvent): void;
  handleHostRequest(event: HostRequestEvent): Promise<void>;
  // Perform a container operation and answer the container with the result. Public because approving a held
  // operation runs it, and the WebDriver spec drives it the same way the approval card does.
  runEngineOp(requestId: string, request: { op: string; args: Record<string, unknown> }): Promise<void>;
  respondToRequest(requestId: string, response: HostResponsePayload): Promise<void>;
  resolveApproval(approvalId: string, decision: "allow" | "reject"): Promise<void>;
  sendSurfaceInput(surfaceId: string, data: string): Promise<void>;
  reportSurfaceWidth(surfaceId: string, columns: number): Promise<void>;
  // Re-read the app's tokens and tell the container. Called on connect and whenever the engine or the
  // light/dark mode repaints them, so plugin output never sits in a theme the app has moved off.
  publishTheme(): Promise<void>;
  // Re-read the project's rules and memories and give them to the container as system prose. Called on connect
  // and before every turn, so a memory added mid-session reaches the model on the next answer.
  publishSystemContext(): Promise<void>;
  // Ask the SESSION whether it can reach the model, through the gateway. Absent when no session runs: the app's own
  // provider check answers for the app's realm, and there is no second answer to give.
  checkSessionProvider(): Promise<SessionProviderCheck | undefined>;
  // Run one of pi's own commands, by pi's name, against the running session. Answers with a value: the palette
  // shows "not available here, and why" rather than raising.
  runPiCommand(name: string, args: string): Promise<PiCommandResult>;
  refreshResources(): Promise<void>;
  // Read back the file pi wrote when it truncated a tool's output. It lives inside the agent container, so the
  // card cannot open it — only the host on the other end of the bridge can.
  readToolOutput(path: string): Promise<{ text: string; truncated: boolean }>;
}

export function noContributedResources(): ContributedResources {
  return { extensions: [], commands: [], skills: [], prompts: [], builtins: [] };
}

// Remove the container pairs and networks a previous run left behind — the app is the only thing that would have,
// and enough leaked networks make the engine refuse to create another one for anybody.
//
// Every running connection is swept, because a session could have been started on any of them. Safe only while the
// app is single-instance: a pi session lives as long as the app holds its bridge client, so at boot anything still
// standing is an orphan. The E2E harness deliberately turns single-instance OFF to run beside a dev app, and its
// second instance must not reap the first one's live session — so the flag that gates the guard gates this too.
export async function reapOrphanedAgentSessions(): Promise<void> {
  const e2e = (globalThis as unknown as { CONTAINER_DESKTOP_E2E?: string }).CONTAINER_DESKTOP_E2E;
  if (isMockMode() || e2e) return;
  // The same source the start drawer's connection picker uses, so the sweep covers exactly the engines a session
  // could have been started on. No scope: sessions are started unscoped, so their leftovers are unscoped too.
  const connections = connectedConnections(
    useAppStore.getState().connections,
    useResourceStore.getState().activeRuntime,
  );
  for (const connection of connections) {
    const host = await resolveConnectionHost(connection.id);
    if (!host) continue;
    await reapOrphanPiAgentSessions(host).catch((error) => logger.debug(`reaping ${connection.id} failed`, error));
  }
}

// The gateway's env file carries the provider key, so the HOST composes and writes it: it reads the key from
// the OS keychain, which is deliberately unreadable from here. Only the path comes back.
async function writeGatewayEnvFile(providerId: string, fileName: string, spec: PiAgentSessionSpec): Promise<string> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) throw new Error("the AI host bridge is unavailable, so the gateway cannot be given its key");
  const { path } = await bridge.writeAgentGatewayEnv({
    provider: providerId,
    fileName,
    baseUrl: gatewayUpstreamUrl(spec),
    bridgeToken: spec.bridgeToken,
    gatewayPort: GATEWAY_PORT_IN_IMAGE,
  });
  return path;
}

// What the provider says this model's budget is. Never fatal: a provider that will not answer leaves the window
// unknown, which the panel states plainly, and the session starts either way.
async function readModelWindow(
  modelId: string,
  providerId?: string,
): Promise<{ contextWindow?: number; maxOutputTokens?: number; pricing?: ModelPricing }> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge || !modelId.trim()) return {};
  try {
    return await bridge.modelWindow(modelId, providerId);
  } catch (error) {
    logger.debug("the provider did not report a context window", error);
    return {};
  }
}

// The agent container's env file, written by the HOST into the same protected directory as the gateway's. It used to
// go to `~/.local/share/container-desktop/agent`, a second directory outside the fs guard — so the bridge token that
// authorises the whole socket was readable from the web view while the provider key beside it was not.
async function writeAgentEnvFile(name: string, contents: string): Promise<string> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) throw new Error("the AI host bridge is unavailable, so the agent cannot be given its environment");
  const { path } = await bridge.writeAgentEnvFile(name, contents);
  return path;
}

export const useCodingAgentStore = create<CodingAgentState>()((set, get) => ({
  status: "idle",
  view: emptyPiThreadView("pi-session"),
  startLog: [],
  chrome: emptyCodingAgentChrome(),
  surfaces: noSurfaces(),
  resources: noContributedResources(),
  pendingEngineOps: {},
  turnReadPublicWeb: false,

  async start(options) {
    set({
      status: "starting",
      startLog: [],
      view: emptyPiThreadView("pi-session"),
      chrome: emptyCodingAgentChrome(),
      surfaces: noSurfaces(),
      resources: noContributedResources(),
      pendingDialog: undefined,
      pendingEngineOps: {},
      activeSkill: undefined,
      turnReadPublicWeb: false,
      systemContext: undefined,
      error: undefined,
      lastStart: options,
    });
    const suffix = randomUUID().slice(0, 8);
    // Mock mode has no engine to run a container on, so the far end of the socket is scripted instead. Only
    // the transport is replaced: the renderer runs its production path over the same bridge events. The import
    // is dynamic and DEV-gated, so a production build never links the mock graph.
    if (isMockMode() && import.meta.env.ENVIRONMENT !== "production") {
      const { createMockPiBridgeClient } = await import("@/ai-system/testing/mockPiBridge");
      const client = createMockPiBridgeClient();
      client.onEvent((event) => get().applyBridgeEvent(event));
      set({
        client,
        connectionId: options.connectionId,
        spec: { workspacePath: options.workspacePath, modelId: options.modelId } as PiAgentSessionSpec,
      });
      await client.connect();
      return;
    }
    const host = await resolveConnectionHost(options.connectionId);
    if (!host) {
      set({ status: "error", error: `no engine host for connection ${options.connectionId}` });
      return;
    }
    // Asked of the PROVIDER, before the session exists: an OpenAI-shaped `/models` listing carries no window, so the
    // only honest source is the provider's own endpoint — LM Studio serves whatever context length it was LOADED with,
    // which is routinely a fraction of what the model could do. Unknown is fine and reported as unknown; what is not
    // fine is the invented number this replaces.
    const modelWindow = await readModelWindow(options.modelId, options.providerId);
    const spec: PiAgentSessionSpec = {
      imageTag: agentImageTag(options.appVersion),
      workspacePath: options.workspacePath,
      hostPort: pickHostPort(),
      bridgeToken: randomUUID(),
      networkName: `cd-agent-net-${suffix}`,
      agentContainerName: `cd-agent-${suffix}`,
      gatewayContainerName: `cd-gateway-${suffix}`,
      pluginVolumeName: "cd-agent-plugins",
      upstreamBaseUrl: options.upstreamBaseUrl,
      ...modelWindow,
      // An endpoint with no declared provider is treated as an OpenAI-shaped bearer upstream — what every
      // provider but Anthropic speaks, and what this pair did before the shape was carried at all.
      providerKind: options.providerKind ?? "openai-compatible",
      upstreamAuth: options.upstreamAuth ?? { scheme: "bearer" },
      modelId: options.modelId,
      egress: options.egress ?? true,
      scope: options.scope,
      // Podman publishes host.containers.internal, docker host.docker.internal. The gateway reaches a provider
      // running on this machine only through that alias — inside the container 127.0.0.1 is the container.
      hostAlias: host.PROGRAM === "podman" ? "host.containers.internal" : "host.docker.internal",
      // Podman maps the invoking user to container root under rootless mode, so the agent user needs an
      // explicit mapping or the bind-mounted workspace is effectively read-only. Docker has no keep-id.
      userMapping: host.PROGRAM === "podman" ? { kind: "keep-id" } : { kind: "none" },
    };
    try {
      set((state) => ({ startLog: [...state.startLog, `starting ${spec.agentContainerName}`] }));
      // The provider key lives in the OS keychain, which the renderer cannot read, so the host composes and writes
      // the gateway's env file. This is now the ONLY producer of a credential-bearing one — naming a provider is
      // what asks for it, and a caller that names none is telling us the endpoint is keyless.
      const gatewayEnvFile = options.providerId
        ? () => writeGatewayEnvFile(options.providerId as string, `${suffix}-gateway.env`, spec)
        : undefined;
      const started = await startPiAgentSession(
        host,
        spec,
        (contents) => writeAgentEnvFile(`${suffix}.env`, contents),
        { gatewayEnvFile },
      );
      // The port the agent ENDED UP on: a taken one is re-picked during the run, so dialing the port that was
      // asked for would reach nothing. The spec is corrected too, since stop() and the panels read it.
      const running: PiAgentSessionSpec = { ...spec, hostPort: started.hostPort };

      const client = createPiBridgeClient({ url: `ws://127.0.0.1:${running.hostPort}/`, token: running.bridgeToken });
      client.onEvent((event) => get().applyBridgeEvent(event));
      await client.connect();
      set({ client, spec: running, connectionId: options.connectionId });
      // Before the first plugin component can render: a component that draws once with pi's built-in
      // palette and only then hears about the app's would flash the wrong colours.
      await get().publishTheme();
      // Before the first turn, and early enough that a failure is visible while the user is still looking at the
      // start drawer rather than at an answer that quietly ignored their rules.
      await get().publishSystemContext();
    } catch (error) {
      logger.error("coding agent start failed", error);
      set((state) => ({
        status: "error",
        error: (error as Error).message,
        startLog: [...state.startLog, (error as Error).message],
        spec,
        connectionId: options.connectionId,
      }));
    }
  },

  async submit(text) {
    const { client } = get();
    if (!client) return;
    await get().publishSystemContext();
    set((state) => ({ view: projectPiThreadView(state.view, { type: "user_message", text }) }));
    await client.prompt(text);
  },

  async submitSkill(input) {
    const { client } = get();
    if (!client) return;
    await get().publishSystemContext();
    set((state) => ({
      view: projectPiThreadView(state.view, { type: "user_message", text: input.displayContent }),
      activeSkill: {
        allowedTools: input.allowedTools ? new Set(input.allowedTools) : undefined,
        tainted: !!input.initialTaint,
      },
    }));
    await client.prompt(input.prompt);
  },

  async restart() {
    const options = get().lastStart;
    if (!options) throw new Error("there is no session to start again");
    await get().stop();
    await get().start(options);
  },

  async newConversation() {
    const { client } = get();
    if (!client) {
      await get().restart();
      return;
    }
    // The transcript is not cleared here: the container answers with `session_replaced`, and clearing on that one
    // event means a session pi refused to replace still shows the conversation the user actually has.
    const result = await client.runCommand("new", "");
    if (!result.ok) throw new Error(result.error);
  },

  async abortTurn() {
    await stopAfterRejection(get().client);
  },

  async stop() {
    const { client, spec, connectionId } = get();
    client?.close();
    // A mock session has no containers to tear down — its spec carries only the workspace and the model.
    if (spec?.agentContainerName && connectionId) {
      const host = await resolveConnectionHost(connectionId);
      if (host) await stopPiAgentSession(host, spec);
    }
    set({
      status: "idle",
      client: undefined,
      spec: undefined,
      connectionId: undefined,
      chrome: emptyCodingAgentChrome(),
      surfaces: noSurfaces(),
      resources: noContributedResources(),
      pendingDialog: undefined,
      pendingEngineOps: {},
      activeSkill: undefined,
      turnReadPublicWeb: false,
      systemContext: undefined,
    });
  },

  // Every bridge event lands here, whether the socket delivered it or a WebDriver spec pushed it, so the
  // transcript a test sees is projected by exactly the code the session uses.
  applyBridgeEvent(event) {
    // The container is running a different conversation than the one on screen — /new, /resume, /clone or /import.
    // Everything held here belongs to the session that is gone, including the dialogs and container operations it
    // was waiting on, so it goes; the entries of the session that replaced it arrive next as ordinary events.
    // The client, the spec and the connection stay: same socket, same containers.
    if (event.type === "session_replaced") {
      set({
        view: emptyPiThreadView("pi-session"),
        chrome: emptyCodingAgentChrome(),
        surfaces: noSurfaces(),
        pendingDialog: undefined,
        pendingEngineOps: {},
        activeSkill: undefined,
        turnReadPublicWeb: false,
      });
      return;
    }
    // A host request is a question, not transcript content: the handler decides what it becomes, and
    // whether the container gets an answer without ever bothering the user.
    if (event.type === "host_request") {
      void get().handleHostRequest(event);
      return;
    }
    // A surface frame is a paint, not transcript content: it replaces what that component last drew and
    // must never append an item to the thread.
    if (event.type === "surface_frame" || event.type === "surface_closed") {
      set((state) => ({ surfaces: applySurfaceEvent(state.surfaces, event) }));
      return;
    }
    // The installed set changed under us, so the palette's commands are stale. The Plugins screen keeps its
    // own subscription for the table; this is only about what the composer offers.
    if (event.type === "plugins_changed") {
      void get().refreshResources();
      return;
    }
    if (event.type === "plugin_progress") return;
    set((state) => ({ view: projectPiThreadView(state.view, event, viewSession(state)) }));
    // A skill narrows only the turn it started. Lifting it here rather than on the next submit keeps a
    // follow-up prompt from inheriting a restriction the user never asked for.
    if (event.type === "turn_end" || event.type === "idle") {
      set({ activeSkill: undefined, turnReadPublicWeb: false });
    }
    if (event.type === "ready") {
      set({ status: "ready" });
      void get().refreshResources();
    }
  },

  async refreshResources() {
    const { client } = get();
    if (!client) return;
    try {
      set({ resources: await client.listResources() });
    } catch (error) {
      // An empty palette is a lesser failure than a broken session, so this stays a warning.
      logger.warn("unable to read the plugin resources", error);
    }
  },

  async handleHostRequest(event) {
    const outcome = classifyHostRequest(event);
    switch (outcome.kind) {
      case "dialog":
        set({ pendingDialog: outcome.request });
        return;
      case "chrome": {
        set((state) => ({ chrome: mergeChrome(state.chrome, outcome.patch) }));
        const notify = outcome.patch.notify;
        if (notify) Notification.show({ message: notify.message, intent: NOTIFY_INTENT[notify.notifyType] });
        return;
      }
      case "approval": {
        const { toolName, args, requestId } = outcome.request;
        const skill = get().activeSkill;
        if (skill?.allowedTools && !skill.allowedTools.has(toolName)) {
          // A declared narrowing, not a user's "no": the model is told exactly why and can pick another tool,
          // so this does not abort the turn the way a rejection does.
          await get().respondToRequest(requestId, {
            ok: true,
            value: { allow: false, reason: `${toolName} is not among this skill's allowed tools` },
          });
          return;
        }
        const mode = permissionMode();
        // Only "remember" consults the cache, so the other modes never pay for a broker round-trip.
        const rule = approvalRule(get(), toolName, args);
        const cached = mode === "remember" && rule ? await rememberedVerdict(rule) : undefined;
        const action = decidePiToolCall({ toolName, mode, cached, boundary: "tool-call", tainted: turnTainted(get()) });
        if (action === "run") {
          await get().respondToRequest(requestId, { ok: true, value: { allow: true } });
          return;
        }
        // Both a rejection and a question get a card: a remembered block should be visible, not silent.
        set((state) => ({ view: projectPiThreadView(state.view, event) }));
        if (action === "reject") {
          await get().respondToRequest(requestId, {
            ok: true,
            value: { allow: false, reason: "blocked by a remembered decision" },
          });
          set((state) => ({
            view: projectPiThreadView(state.view, { type: "approval_settled", requestId, allowed: false }),
          }));
          await stopAfterRejection(get().client);
        }
        return;
      }
      case "engine-op": {
        const { op, args, requestId } = outcome.request;
        const skill = get().activeSkill;
        if (skill?.allowedTools && !skill.allowedTools.has(op)) {
          await get().respondToRequest(requestId, {
            ok: true,
            value: { ok: false, error: `${op} is not among this skill's allowed tools` } satisfies EngineOpResult,
          });
          return;
        }
        const mode = permissionMode();
        const rule = approvalRule(get(), op, args);
        const cached = mode === "remember" && rule ? await rememberedVerdict(rule) : undefined;
        // The same decision path as a pi tool call: reads run unattended, mutations ask. This is the boundary that
        // decides for a container operation — the app performs it, so the pre-call gate deferred to here.
        const action = decidePiToolCall({
          toolName: op,
          mode,
          cached,
          boundary: "engine-op",
          tainted: turnTainted(get()),
        });
        if (action === "run") {
          await get().runEngineOp(requestId, { op, args });
          return;
        }
        set((state) => ({ view: projectPiThreadView(state.view, event, viewSession(state)) }));
        if (action === "reject") {
          await get().respondToRequest(requestId, {
            ok: true,
            value: { ok: false, error: "blocked by a remembered decision" } satisfies EngineOpResult,
          });
          set((state) => ({
            view: projectPiThreadView(state.view, { type: "approval_settled", requestId, allowed: false }),
          }));
          await stopAfterRejection(get().client);
          return;
        }
        // Held until the user answers: unlike a pi tool, nothing runs this but the app itself.
        set((state) => ({ pendingEngineOps: { ...state.pendingEngineOps, [requestId]: { op, args } } }));
        return;
      }
      case "web-search": {
        const { requestId, query } = outcome.request;
        const skill = get().activeSkill;
        if (skill?.allowedTools && !skill.allowedTools.has(WEB_SEARCH_TOOL_NAME)) {
          await get().respondToRequest(requestId, {
            ok: true,
            value: {
              ok: false,
              error: `${WEB_SEARCH_TOOL_NAME} is not among this skill's allowed tools`,
            } satisfies WebSearchAnswer,
          });
          return;
        }
        // No card: this tool's gate is the user's own switch in Settings → AI, which the broker enforces on every
        // call. What a search DOES change is trust — the turn has now read a page anyone could have published, so
        // the taint is set before the answer goes back, in time for whatever the model does with it.
        const answer = await performWebSearch(query);
        if (answer.ok) set({ turnReadPublicWeb: true });
        await get().respondToRequest(requestId, { ok: true, value: answer });
        return;
      }
      default:
        logger.debug("ignoring an unsupported host request", event.method);
    }
  },

  async runEngineOp(requestId, request) {
    const result = await performEngineOp(request, get().connectionId);
    set((state) => {
      if (!state.pendingEngineOps[requestId]) return {};
      const { [requestId]: _done, ...rest } = state.pendingEngineOps;
      return { pendingEngineOps: rest };
    });
    // The envelope always succeeds — a failed operation is a value the model reads, not a broken response.
    await get().respondToRequest(requestId, { ok: true, value: result });
  },

  async respondToRequest(requestId, response) {
    const { client, pendingDialog } = get();
    if (pendingDialog?.requestId === requestId) set({ pendingDialog: undefined });
    if (!client) return;
    await client.respond(requestId, response);
  },

  async resolveApproval(approvalId, decision) {
    const allow = decision === "allow";
    // A held container operation is performed by the app, so approving it means running it now and answering with
    // what the engine said. Answering `{ allow: true }` would leave the agent waiting for a result nobody produces.
    const held = get().pendingEngineOps[approvalId];
    if (held) {
      if (allow) await get().runEngineOp(approvalId, held);
      else {
        await get().respondToRequest(approvalId, {
          ok: true,
          value: { ok: false, error: "rejected by the user" } satisfies EngineOpResult,
        });
        set((state) => {
          const { [approvalId]: _rejected, ...rest } = state.pendingEngineOps;
          return { pendingEngineOps: rest };
        });
      }
    } else {
      await get().respondToRequest(approvalId, {
        ok: true,
        value: allow ? { allow: true } : { allow: false, reason: "rejected by the user" },
      });
    }
    set((state) => ({
      view: projectPiThreadView(state.view, { type: "approval_settled", requestId: approvalId, allowed: allow }),
    }));
    if (!allow) await stopAfterRejection(get().client);
    if (permissionMode() !== "remember") return;
    await rememberVerdict(get(), approvalId, allow);
  },

  async sendSurfaceInput(surfaceId, data) {
    await get().client?.surfaceInput(surfaceId, data);
  },

  async reportSurfaceWidth(surfaceId, columns) {
    await get().client?.surfaceResize(surfaceId, columns);
  },

  async readToolOutput(path) {
    const { client } = get();
    if (!client) throw new Error("the coding agent session is not running");
    return client.readToolOutput(path);
  },

  async publishTheme() {
    const { client } = get();
    if (!client) return;
    try {
      await client.setTheme(readAppPiThemePalette());
    } catch (error) {
      // A theme the container never heard about only costs fidelity, so this must not fail a session.
      logger.warn("unable to publish the app theme to the agent", error);
    }
  },

  async checkSessionProvider() {
    const { client } = get();
    if (!client) return undefined;
    try {
      return await client.checkProvider();
    } catch (error) {
      // The probe itself failing IS the answer: the session could not even be asked.
      return { reachable: false, error: (error as Error).message };
    }
  },

  async runPiCommand(name, args) {
    const { client } = get();
    if (!client) return { ok: false, error: "there is no session to run a pi command in" };
    try {
      return await client.runCommand(name, args);
    } catch (error) {
      // A lost socket or a container that predates the command: both are reasons, not crashes.
      logger.error("a pi command failed", name, error);
      return { ok: false, error: (error as Error).message };
    }
  },

  async publishSystemContext() {
    const { client } = get();
    if (!client) return;
    const snapshot = await readProjectContext();
    if (!snapshot) return;
    const composed = composeSessionSystemContext(snapshot);
    if ((get().systemContext?.text ?? "") === composed.text) return;
    try {
      await client.setSystemContext(composed.text);
      set({ systemContext: composed });
    } catch (error) {
      // Recording it as delivered here would stop every later turn from retrying, leaving the session silently
      // rule-less — the exact defect this publishing exists to close. Say so and leave it undelivered.
      logger.error("unable to give the agent this project's context", error);
      Notification.show({
        message: t("The assistant did not receive this project's rules and memories"),
        detail: (error as Error).message,
        intent: Intent.WARNING,
      });
    }
  },
}));

// Host-side workspace access follows the folder THIS session mounted, not the one named in Settings → AI. Bound
// here, at module scope, because the store is the only thing that knows it and a reader cannot go stale: stopping
// the session clears the spec, which hands the folder straight back to Settings.
bindSessionWorkspace(() => useCodingAgentStore.getState().spec?.workspacePath);

// DEV-only handle for the WebDriver spec, mirroring window.__cdLiveProbe: the spec drives the store
// directly so the screen's rendering can be asserted without a live container session.
export function installCodingAgentProbe(): void {
  (globalThis as { __cdCodingAgentStore?: typeof useCodingAgentStore }).__cdCodingAgentStore = useCodingAgentStore;
}
