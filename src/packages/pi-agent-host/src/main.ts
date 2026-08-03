import { WebSocketServer } from "ws";

import { createLogger } from "@/logger";
import { startGateway } from "@/pi-agent-host/gateway";
import { attachBridgeConnection } from "@/pi-agent-host/server";
import { createPiSession } from "@/pi-agent-host/session";

const logger = createLogger("pi-agent-host.main");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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
      emit: (event) => attached?.emit(event),
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
      apiKey: required("CD_UPSTREAM_API_KEY"),
      bridgeToken: required("CD_BRIDGE_TOKEN"),
    },
    Number(process.env.CD_GATEWAY_PORT ?? "8788"),
  );
}

const mode = argValue("--mode") ?? "agent";
await (mode === "gateway" ? runGateway() : runAgent());
