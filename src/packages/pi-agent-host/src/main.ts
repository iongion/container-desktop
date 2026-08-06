import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { WebSocketServer } from "ws";

import { createLogger } from "@/logger";
import { attachLoginConnection } from "@/pi-agent-host/authLogin";
import {
  containerToolDescriptions,
  knowledgeBankEntries,
  workspaceToolDescriptions,
} from "@/pi-agent-host/containerToolDescriptions";
import { loadEnvFile } from "@/pi-agent-host/envFile";
import { reasoningFromEnv } from "@/pi-agent-host/modelRegistrations";
import { startProviderProxy } from "@/pi-agent-host/providerProxy";
import { attachBridgeConnection } from "@/pi-agent-host/server";
import { createPiSession } from "@/pi-agent-host/session";
import {
  installPiSessionStorage,
  type PiSessionStorage,
  piSessionStorageOver,
  workerSessionStorageTransport,
} from "@/pi-agent-host/sessionStorage";
import { parseUpstreamModelApi } from "@/pi-bridge/providerEndpoint";

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

// The conversations belong on the user's machine even when the engine runs somewhere this container's filesystem
// cannot be mounted from. Installed BEFORE the first session exists, because pi resolves the store once per
// `SessionManager` and one built earlier would keep the filesystem.
async function installConversationStore(token: string): Promise<PiSessionStorage | undefined> {
  const port = Number(process.env.CD_SESSION_STORAGE_PORT);
  if (!Number.isInteger(port) || port <= 0) return undefined;
  const transport = workerSessionStorageTransport({
    port,
    token,
    // Beside this bundle in the image. Resolved from the module's own URL rather than an absolute path, so the two
    // files travel together and a relocated `/opt/cd-agent` needs no second edit.
    workerPath: new URL("./session-storage-worker.mjs", import.meta.url),
  });
  const storage = piSessionStorageOver(transport);
  await installPiSessionStorage(storage);
  logger.info(`conversations are served by the app over port ${port}`);
  // Returned as well as installed: pi resolves the store itself for everything it reads and writes, but `/import`
  // writes a file pi is then asked to read, and that write is ours.
  return storage;
}

async function runAgent(): Promise<void> {
  const token = required("CD_BRIDGE_TOKEN");
  const sessionStorage = await installConversationStore(token);
  const port = Number(process.env.CD_BRIDGE_PORT ?? "8787");
  const server = new WebSocketServer({ host: "0.0.0.0", port });
  logger.info(`agent bridge listening on ${port}`);

  // Whichever bridge connection is live, for the frames the provider proxy has to send. There is only ever one, and it
  // is assigned once the session behind it is built.
  let attached: ReturnType<typeof attachBridgeConnection> | undefined;
  let requests = 0;
  // ONE proxy for the container, not one per connection: it binds a port, so a second bind would fail, and pi is
  // registered against it before anything has dialled the bridge. A request arriving with no connection throws here
  // and the proxy fails that request rather than blocking pi on an answer nothing will send.
  const providerProxy = await startProviderProxy({
    token,
    newRequestId: () => `pv-${++requests}`,
    transport: {
      send: (request) => {
        if (!attached) throw new Error("the app is not connected, so inference cannot be carried to it");
        attached.emit({ type: "provider_request", request });
      },
      cancel: (requestId) => attached?.emit({ type: "provider_cancel", requestId }),
    },
  });

  server.on("connection", (socket) => {
    // Frames that arrive while the session is still being built are queued rather than dropped: the
    // client sends `hello` immediately on open and must not have to retry it.
    const pending: string[] = [];

    socket.on("message", (data) => {
      const frame = data.toString();
      if (attached) void attached.handleFrame(frame);
      else pending.push(frame);
    });
    // Every request in flight is waiting on THIS socket. A session whose app has gone must fail them rather than leave
    // pi blocked on a stream that will never produce another byte.
    socket.on("close", () => {
      attached = undefined;
      providerProxy.proxy.failAll("the agent bridge closed");
    });

    void createPiSession({
      cwd: process.env.CD_WORKSPACE ?? "/workspace",
      agentDir: process.env.CD_AGENT_DIR ?? "/home/agent/.pi/agent",
      // Set only when the app mounted a directory for the conversations. Absent, pi keeps defaulting them under the
      // agent dir — the plugin volume — which is the behaviour this replaces.
      sessionDir: process.env.CD_SESSION_DIR,
      // Absent for a mounted directory, where pi's own default store is already the right place.
      ...(sessionStorage ? { sessionStorage } : {}),
      providerToken: token,
      modelId: required("CD_MODEL_ID"),
      modelApi: parseUpstreamModelApi(process.env.CD_MODEL_API),
      // Absent for a session started before the app sent it: pi then reads our own endpoint as it always did, which is
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
          { token, session, providerProxy: providerProxy.proxy },
        );
        for (const frame of pending.splice(0)) await attached.handleFrame(frame);
      })
      .catch((error) => {
        logger.error("failed to start the pi session", error);
        socket.close(4500, "session start failed");
      });
  });
}

// The second mode, and the shortest-lived: one provider sign-in, then the container is removed. It exists because
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

// Before either mode reads a variable: for an engine on another machine the environment arrives as a file in a
// session volume rather than through `--env-file`, which that engine's client reads on ITS filesystem.
await loadEnvFile(process.env.CD_ENV_FILE);

const mode = argValue("--mode") ?? "agent";
await (mode === "login" ? runLogin() : runAgent());
