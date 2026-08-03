// Session state for the containerized pi coding agent: it owns the container pair, the bridge client and
// the projected transcript. The provider key travels from settings into the gateway's private env file and
// is never held in this store's state.
import { create } from "zustand";

import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import { startPiAgentSession, stopPiAgentSession } from "@/ai-system/adapters/piAgentContainer";
import { createPiBridgeClient, type PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiThreadView, projectPiThreadView } from "@/ai-system/core/piThreadView";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import { createLogger } from "@/logger";
import { agentImageTag } from "@/pi-bridge/image";
import { randomUUID } from "@/utils/randomUUID";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";

const logger = createLogger("web-app.codingAgent");

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
  start(options: StartCodingAgentOptions): Promise<void>;
  submit(text: string): Promise<void>;
  stop(): Promise<void>;
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

  async start(options) {
    set({ status: "starting", startLog: [], view: emptyPiThreadView("pi-session"), error: undefined });
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
    set({ status: "idle", client: undefined, spec: undefined, connectionId: undefined });
  },
}));

// DEV-only handle for the WebDriver spec, mirroring window.__cdLiveProbe: the spec drives the store
// directly so the screen's rendering can be asserted without a live container session.
export function installCodingAgentProbe(): void {
  (globalThis as { __cdCodingAgentStore?: typeof useCodingAgentStore }).__cdCodingAgentStore = useCodingAgentStore;
}
