import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ExtensionAPI,
  type InlineExtension,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createLogger } from "@/logger";
import { mapAgentEvent, type PiAgentEvent } from "@/pi-agent-host/events";
import type { BridgeSessionHandle } from "@/pi-agent-host/server";
import type { BridgeEvent } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.session");

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
  modelId: string;
  emit: (event: BridgeEvent) => void;
  streamOverride?: PiStreamFn;
}

export async function createPiSession(options: CreatePiSessionOptions): Promise<BridgeSessionHandle> {
  const { cwd, agentDir, gatewayUrl, modelId, emit, streamOverride } = options;

  // The inline extension registers the gateway provider. Its registration is queued by the extension
  // runtime and flushed by createAgentSessionServices — the low-level createAgentSession does NOT flush
  // it, which is why services are built here rather than calling createAgentSession directly.
  const gatewayExtension: InlineExtension = {
    name: "container-desktop-gateway",
    factory: (pi: ExtensionAPI) => {
      pi.registerProvider(GATEWAY_PROVIDER_ID, {
        // baseUrl is required: the provider composer validates it when defining custom models.
        baseUrl: gatewayUrl,
        // A placeholder, not a credential. The real key lives in the gateway container; this only has to
        // be non-empty so pi's key-existence check passes.
        apiKey: "gateway",
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

  // In-memory settings: the agent container has no user settings file to honour, and this keeps the
  // session from writing one into the mounted plugin volume.
  const settingsManager = SettingsManager.inMemory({});
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: { extensionFactories: [gatewayExtension] },
  });
  await services.modelRuntime.setRuntimeApiKey(GATEWAY_PROVIDER_ID, "gateway", { allowNetwork: false });

  const model = services.modelRuntime.getModel(GATEWAY_PROVIDER_ID, modelId);
  if (!model) {
    throw new Error(`gateway model ${modelId} was not registered — the provider flush did not happen`);
  }

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd),
    model,
  });

  session.subscribe((event) => {
    for (const mapped of mapAgentEvent(event as unknown as PiAgentEvent)) emit(mapped);
  });

  return {
    sessionId: session.sessionId,
    cwd,
    model: `${GATEWAY_PROVIDER_ID}/${modelId}`,
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
    resolveUi() {
      // Extension UI arrives in a later phase; there are no outstanding requests to resolve yet.
    },
  };
}
