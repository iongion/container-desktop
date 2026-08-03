// Session state for the containerized pi coding agent: it owns the container pair, the bridge client and
// the projected transcript. The provider key travels from settings into the gateway's private env file and
// is never held in this store's state.
import { create } from "zustand";

import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import { startPiAgentSession, stopPiAgentSession } from "@/ai-system/adapters/piAgentContainer";
import { createPiBridgeClient, type PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { type CodingTranscriptItem, projectTranscript } from "@/ai-system/core/codingTranscript";
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
  items: CodingTranscriptItem[];
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
  items: [],
  startLog: [],

  async start(options) {
    set({ status: "starting", startLog: [], items: [], error: undefined });
    const suffix = randomUUID().slice(0, 8);
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
    };
    try {
      const host = await resolveConnectionHost(options.connectionId);
      if (!host) throw new Error(`no engine host for connection ${options.connectionId}`);
      set((state) => ({ startLog: [...state.startLog, `starting ${spec.agentContainerName}`] }));
      await startPiAgentSession(host, spec, (contents) => writePrivateEnvFile(`${suffix}.env`, contents));

      const client = createPiBridgeClient({ url: `ws://127.0.0.1:${spec.hostPort}/`, token: spec.bridgeToken });
      client.onEvent((event) => {
        set((state) => ({ items: projectTranscript(state.items, event) }));
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
    set((state) => ({ items: [...state.items, { kind: "user", id: randomUUID(), text }] }));
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
