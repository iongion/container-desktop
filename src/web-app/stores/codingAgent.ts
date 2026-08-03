// Session state for the containerized pi coding agent: it owns the container pair, the bridge client and
// the projected transcript. The provider key travels from settings into the gateway's private env file and
// is never held in this store's state.
import { Intent } from "@blueprintjs/core";
import { create } from "zustand";

import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import { startPiAgentSession, stopPiAgentSession } from "@/ai-system/adapters/piAgentContainer";
import {
  createPiBridgeClient,
  type HostResponsePayload,
  type PiBridgeClient,
} from "@/ai-system/adapters/piBridgeClient";
import {
  type AIPermissionMode,
  cachedVerdict,
  type PermissionRule,
  permissionKey,
  toolRule,
} from "@/ai-system/core/permissions";
import { decidePiToolCall, piPermissionContext } from "@/ai-system/core/piApprovals";
import { emptyPiThreadView, projectPiThreadView } from "@/ai-system/core/piThreadView";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import { type ChromePatch, classifyHostRequest, type PendingUiRequest } from "@/ai-system/core/uiRequests";
import { createLogger } from "@/logger";
import { agentImageTag } from "@/pi-bridge/image";
import type { BridgeEvent, ContributedResources, EngineOpResult } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { applySurfaceEvent, type CodingAgentSurfaces, noSurfaces } from "@/web-app/stores/codingAgentSurfaces";
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

export interface StartCodingAgentOptions {
  connectionId: string;
  workspacePath: string;
  modelId: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  appVersion: string;
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
  start(options: StartCodingAgentOptions): Promise<void>;
  submit(text: string): Promise<void>;
  stop(): Promise<void>;
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
  refreshResources(): Promise<void>;
}

export function noContributedResources(): ContributedResources {
  return { extensions: [], commands: [], skills: [], prompts: [] };
}

// The published port is picked per session. A collision surfaces as an engine error on run, which the
// start log shows verbatim — cheaper and clearer than probing for a free port from the renderer.
function pickHostPort(): number {
  return 41000 + Math.floor(Math.random() * 4000);
}

async function writePrivateEnvFile(name: string, contents: string): Promise<string> {
  const home = await Platform.getHomeDir();
  const dir = await Path.join(home, ".local/share/container-desktop/agent");
  await FS.mkdir(dir, { recursive: true });
  const location = await Path.join(dir, name);
  await FS.writePrivateTextFile(location, contents);
  return location;
}

export const useCodingAgentStore = create<CodingAgentState>()((set, get) => ({
  status: "idle",
  view: emptyPiThreadView("pi-session"),
  startLog: [],
  chrome: emptyCodingAgentChrome(),
  surfaces: noSurfaces(),
  resources: noContributedResources(),
  pendingEngineOps: {},

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
      error: undefined,
    });
    const suffix = randomUUID().slice(0, 8);
    const host = await resolveConnectionHost(options.connectionId);
    if (!host) {
      set({ status: "error", error: `no engine host for connection ${options.connectionId}` });
      return;
    }
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
      upstreamApiKey: options.upstreamApiKey,
      modelId: options.modelId,
      egress: options.egress ?? true,
      scope: options.scope,
      // Podman maps the invoking user to container root under rootless mode, so the agent user needs an
      // explicit mapping or the bind-mounted workspace is effectively read-only. Docker has no keep-id.
      userMapping: host.PROGRAM === "podman" ? { kind: "keep-id" } : { kind: "none" },
    };
    try {
      set((state) => ({ startLog: [...state.startLog, `starting ${spec.agentContainerName}`] }));
      await startPiAgentSession(host, spec, (contents) => writePrivateEnvFile(`${suffix}.env`, contents));

      const client = createPiBridgeClient({ url: `ws://127.0.0.1:${spec.hostPort}/`, token: spec.bridgeToken });
      client.onEvent((event) => get().applyBridgeEvent(event));
      await client.connect();
      set({ client, spec, connectionId: options.connectionId });
      // Before the first plugin component can render: a component that draws once with pi's built-in
      // palette and only then hears about the app's would flash the wrong colours.
      await get().publishTheme();
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
    set((state) => ({ view: projectPiThreadView(state.view, { type: "user_message", text }) }));
    await client.prompt(text);
  },

  async stop() {
    const { client, spec, connectionId } = get();
    client?.close();
    if (spec && connectionId) {
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
    });
  },

  // Every bridge event lands here, whether the socket delivered it or a WebDriver spec pushed it, so the
  // transcript a test sees is projected by exactly the code the session uses.
  applyBridgeEvent(event) {
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
    set((state) => ({ view: projectPiThreadView(state.view, event) }));
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
        const mode = permissionMode();
        // Only "remember" consults the cache, so the other modes never pay for a broker round-trip.
        const rule = approvalRule(get(), toolName, args);
        const cached = mode === "remember" && rule ? await rememberedVerdict(rule) : undefined;
        const action = decidePiToolCall({ toolName, mode, cached });
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
        const mode = permissionMode();
        const rule = approvalRule(get(), op, args);
        const cached = mode === "remember" && rule ? await rememberedVerdict(rule) : undefined;
        // The same decision path as a pi tool call: reads run unattended, mutations ask. There is no second gate.
        const action = decidePiToolCall({ toolName: op, mode, cached });
        if (action === "run") {
          await get().runEngineOp(requestId, { op, args });
          return;
        }
        set((state) => ({ view: projectPiThreadView(state.view, event) }));
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
}));

// DEV-only handle for the WebDriver spec, mirroring window.__cdLiveProbe: the spec drives the store
// directly so the screen's rendering can be asserted without a live container session.
export function installCodingAgentProbe(): void {
  (globalThis as { __cdCodingAgentStore?: typeof useCodingAgentStore }).__cdCodingAgentStore = useCodingAgentStore;
}
