import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { WebSocketServer } from "ws";

import { createLogger } from "@/logger";
import { attachLoginConnection } from "@/pi-agent-host/authLogin";
import {
  containerToolDescriptions,
  knowledgeBankEntries,
  workspaceToolDescriptions,
} from "@/pi-agent-host/containerToolDescriptions";
import { parseUpstreamAuthScheme, startGateway } from "@/pi-agent-host/gateway";
import { reasoningFromEnv } from "@/pi-agent-host/modelRegistrations";
import { attachBridgeConnection } from "@/pi-agent-host/server";
import { createPiSession, parseModelApi } from "@/pi-agent-host/session";

const logger = createLogger("pi-agent-host.main");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// A token count from the environment, kept only when it is a usable positive number: an env var is a string from
// another process, and a zero or a typo must read as "the provider did not say", not as a window of nothing.
function positiveEnv(name: string, key: "contextWindow" | "maxOutputTokens"): Record<string, number> {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? { [key]: Math.floor(value) } : {};
}

// The provider's rates, in dollars per million tokens. Fractional, unlike a token count, and absent entirely for a
// model nobody charges for — pi's own rate table is already zeroes, so there is nothing to say about a free model.
function pricingEnv(): Record<string, number> | undefined {
  const rates = {
    input: Number(process.env.CD_MODEL_COST_INPUT),
    output: Number(process.env.CD_MODEL_COST_OUTPUT),
    cacheRead: Number(process.env.CD_MODEL_COST_CACHE_READ),
    cacheWrite: Number(process.env.CD_MODEL_COST_CACHE_WRITE),
  };
  const published = Object.entries(rates).filter(([, value]) => Number.isFinite(value) && value > 0);
  return published.length ? Object.fromEntries(published) : undefined;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function runAgent(): Promise<void> {
  const token = required("CD_BRIDGE_TOKEN");
  const port = Number(process.env.CD_BRIDGE_PORT ?? "8787");
  const server = new WebSocketServer({ host: "0.0.0.0", port });
  logger.info(`agent bridge listening on ${port}`);

  server.on("connection", (socket) => {
    // Frames that arrive while the session is still being built are queued rather than dropped: the
    // client sends `hello` immediately on open and must not have to retry it.
    const pending: string[] = [];
    let attached: ReturnType<typeof attachBridgeConnection> | undefined;

    socket.on("message", (data) => {
      const frame = data.toString();
      if (attached) void attached.handleFrame(frame);
      else pending.push(frame);
    });

    void createPiSession({
      cwd: process.env.CD_WORKSPACE ?? "/workspace",
      agentDir: process.env.CD_AGENT_DIR ?? "/home/agent/.pi/agent",
      gatewayUrl: required("CD_GATEWAY_URL"),
      gatewayToken: token,
      modelId: required("CD_MODEL_ID"),
      modelApi: parseModelApi(process.env.CD_MODEL_API),
      // Absent for a session started before the app sent it: pi then reads our gateway as it always did, which is
      // the right answer for every upstream it would not have treated specially anyway.
      upstreamBaseUrl: process.env.CD_UPSTREAM_BASE_URL,
      // Absent when the provider did not publish one. Passing nothing is how the session says "unknown" rather than
      // registering a window a server would refuse.
      ...positiveEnv("CD_MODEL_CONTEXT_WINDOW", "contextWindow"),
      ...positiveEnv("CD_MODEL_MAX_OUTPUT_TOKENS", "maxOutputTokens"),
      pricing: pricingEnv(),
      // Absent unless a provider published a reasoning capability for this model, which is what decides whether the
      // session offers a thinking level at all.
      reasoning: reasoningFromEnv(process.env),
      emit: (event) => attached?.emit(event),
      containerToolDescriptions: containerToolDescriptions(),
      knowledgeEntries: knowledgeBankEntries(),
      // Offered only when the app said it has somewhere to run them. The target itself never comes here: it is the
      // app that resolves it, and telling the container where its files land would be telling it something it has no
      // use for and no way to reach.
      ...(process.env.CD_WORKSPACE_TOOLS === "1" ? { workspaceToolDescriptions: workspaceToolDescriptions() } : {}),
    })
      .then(async (session) => {
        attached = attachBridgeConnection(
          { send: (frame) => socket.send(frame), close: (code, reason) => socket.close(code, reason) },
          { token, session },
        );
        for (const frame of pending.splice(0)) await attached.handleFrame(frame);
      })
      .catch((error) => {
        logger.error("failed to start the pi session", error);
        socket.close(4500, "session start failed");
      });
  });
}

async function runGateway(): Promise<void> {
  await startGateway(
    {
      upstreamBaseUrl: required("CD_UPSTREAM_BASE_URL"),
      // NOT required: a keyless local server (LM Studio, llama.cpp) writes an empty key, and demanding one
      // here killed the gateway container before it ever listened.
      apiKey: process.env.CD_UPSTREAM_API_KEY ?? "",
      bridgeToken: required("CD_BRIDGE_TOKEN"),
      upstreamKind: process.env.CD_UPSTREAM_KIND,
      authScheme: parseUpstreamAuthScheme(process.env.CD_UPSTREAM_AUTH_SCHEME),
      authHeaderName: process.env.CD_UPSTREAM_AUTH_HEADER_NAME,
      authUsername: process.env.CD_UPSTREAM_AUTH_USERNAME,
    },
    Number(process.env.CD_GATEWAY_PORT ?? "8788"),
  );
}

// The third mode, and the shortest-lived: one provider sign-in, then the container is removed. It exists because
// pi's login flows run a loopback callback server and derive PKCE with `node:crypto` — Node-only code the renderer
// cannot load at all, by pi's own design.
async function runLogin(): Promise<void> {
  const token = required("CD_BRIDGE_TOKEN");
  const port = Number(process.env.CD_BRIDGE_PORT ?? "8787");
  const server = new WebSocketServer({ host: "0.0.0.0", port });
  logger.info(`login bridge listening on ${port}`);
  // Constructed once per connection request rather than held: a provider is a plain object over already-imported
  // data, and reading pi's own list is what keeps the app from carrying a table of who can be signed into.
  const findProvider = (providerId: string) => builtinProviders().find((provider) => provider.id === providerId);

  server.on("connection", (socket) => {
    const attached = attachLoginConnection(
      { send: (frame) => socket.send(frame), close: (code, reason) => socket.close(code, reason) },
      { token, findProvider },
    );
    socket.on("message", (data) => void attached.handleFrame(data.toString()));
  });
}

const mode = argValue("--mode") ?? "agent";
await (mode === "gateway" ? runGateway() : mode === "login" ? runLogin() : runAgent());
