import type { HostResponse } from "@/pi-agent-host/hostRpc";
import { decodeCommand, encodeEvent } from "@/pi-bridge/codec";
import { type BridgeCommand, type BridgeEvent, PI_BRIDGE_PROTOCOL_VERSION } from "@/pi-bridge/protocol";

export interface BridgeConnection {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export interface BridgeSessionHandle {
  sessionId: string;
  cwd: string;
  model?: string;
  prompt(text: string, streamingBehavior?: "steer" | "followUp"): Promise<void>;
  abort(): Promise<void>;
  settleHostResponse(requestId: string, response: HostResponse): void;
}

export interface AttachedBridgeConnection {
  handleFrame(raw: string): Promise<void>;
  emit(event: BridgeEvent): void;
}

export function attachBridgeConnection(
  connection: BridgeConnection,
  options: { token: string; session: BridgeSessionHandle },
): AttachedBridgeConnection {
  const { token, session } = options;
  let greeted = false;

  // Before the handshake only protocol-level frames may leave: agent output must not reach an
  // unauthenticated peer.
  const emit = (event: BridgeEvent) => {
    if (!greeted && event.type !== "error" && event.type !== "response") return;
    connection.send(encodeEvent(event));
  };
  const respond = (id: string, success: boolean, error?: string) =>
    connection.send(encodeEvent(error ? { type: "response", id, success, error } : { type: "response", id, success }));

  const handshake = (command: Extract<BridgeCommand, { type: "hello" }>) => {
    if (command.token !== token) {
      connection.close(4401, "unauthorized");
      return;
    }
    if (command.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
      connection.close(4426, "protocol version mismatch");
      return;
    }
    greeted = true;
    respond(command.id, true);
    emit({
      type: "ready",
      protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      cwd: session.cwd,
      model: session.model,
    });
  };

  const dispatch = async (command: BridgeCommand): Promise<void> => {
    switch (command.type) {
      case "prompt":
        await session.prompt(command.text, command.streamingBehavior);
        return;
      case "abort":
        await session.abort();
        return;
      case "host_response":
        session.settleHostResponse(command.requestId, {
          ok: command.ok,
          value: command.value,
          error: command.error,
        });
        return;
      case "hello":
        return;
    }
  };

  return {
    emit,
    async handleFrame(raw: string): Promise<void> {
      let command: BridgeCommand;
      try {
        command = decodeCommand(raw);
      } catch (error) {
        connection.send(encodeEvent({ type: "error", message: (error as Error).message }));
        return;
      }
      if (command.type === "hello") {
        handshake(command);
        return;
      }
      if (!greeted) {
        respond(command.id, false, "handshake required");
        return;
      }
      try {
        await dispatch(command);
        respond(command.id, true);
      } catch (error) {
        respond(command.id, false, (error as Error).message);
      }
    },
  };
}
