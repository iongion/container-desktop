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
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

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
  // The one blocking dialog an extension is waiting on. pi's dialogs are modal by nature — the agent is
  // parked until answered — so a single slot is the honest model.
  pendingDialog?: PendingUiRequest;
  start(options: StartCodingAgentOptions): Promise<void>;
  submit(text: string): Promise<void>;
  stop(): Promise<void>;
  handleHostRequest(event: HostRequestEvent): Promise<void>;
  respondToRequest(requestId: string, response: HostResponsePayload): Promise<void>;
  resolveApproval(approvalId: string, decision: "allow" | "reject"): Promise<void>;
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

  async start(options) {
    set({
      status: "starting",
      startLog: [],
      view: emptyPiThreadView("pi-session"),
      chrome: emptyCodingAgentChrome(),
      pendingDialog: undefined,
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
      client.onEvent((event) => {
        // A host request is a question, not transcript content: the handler decides what it becomes, and
        // whether the container gets an answer without ever bothering the user.
        if (event.type === "host_request") {
          void get().handleHostRequest(event);
          return;
        }
        set((state) => ({ view: projectPiThreadView(state.view, event) }));
        if (event.type === "ready") set({ status: "ready" });
      });
      await client.connect();
      set({ client, spec, connectionId: options.connectionId });
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
      pendingDialog: undefined,
    });
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
      default:
        logger.debug("ignoring an unsupported host request", event.method);
    }
  },

  async respondToRequest(requestId, response) {
    const { client, pendingDialog } = get();
    if (pendingDialog?.requestId === requestId) set({ pendingDialog: undefined });
    if (!client) return;
    await client.respond(requestId, response);
  },

  async resolveApproval(approvalId, decision) {
    const allow = decision === "allow";
    await get().respondToRequest(approvalId, {
      ok: true,
      value: allow ? { allow: true } : { allow: false, reason: "rejected by the user" },
    });
    set((state) => ({
      view: projectPiThreadView(state.view, { type: "approval_settled", requestId: approvalId, allowed: allow }),
    }));
    if (!allow) await stopAfterRejection(get().client);
    if (permissionMode() !== "remember") return;
    await rememberVerdict(get(), approvalId, allow);
  },
}));

// DEV-only handle for the WebDriver spec, mirroring window.__cdLiveProbe: the spec drives the store
// directly so the screen's rendering can be asserted without a live container session.
export function installCodingAgentProbe(): void {
  (globalThis as { __cdCodingAgentStore?: typeof useCodingAgentStore }).__cdCodingAgentStore = useCodingAgentStore;
}
