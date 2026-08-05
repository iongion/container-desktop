// The part of a bridge connection that is the same whatever is on the far end: the handshake, the emission gate that
// keeps agent output away from an unauthenticated peer, and the response frame. Shared by the SESSION connection and
// the one-shot LOGIN connection so the token check exists once — a second copy of it is a second place to get wrong.

import { decodeCommand, encodeEvent } from "@/pi-bridge/codec";
import { type BridgeCommand, type BridgeEvent, PI_BRIDGE_PROTOCOL_VERSION } from "@/pi-bridge/protocol";

export interface BridgeConnection {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export interface AttachedBridgeConnection {
  handleFrame(raw: string): Promise<void>;
  emit(event: BridgeEvent): void;
}

// The correlation id of a frame the codec refused. Read leniently and on purpose: the frame is already known to be
// unusable, and the only question left is whether someone is waiting on an answer to it.
function pendingId(raw: string): string | undefined {
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function attachBridgeChannel(
  connection: BridgeConnection,
  options: {
    token: string;
    // What to announce once the peer is authenticated, when there is anything to announce. A session says what it
    // is; a login has no session, no cwd and no model, so it says nothing and the handshake response is the signal.
    greeting?: () => BridgeEvent | undefined;
    // A command that answers with data returns it; the rest return undefined and the response carries no result.
    dispatch: (command: BridgeCommand) => Promise<unknown>;
  },
): AttachedBridgeConnection {
  let greeted = false;

  const emit = (event: BridgeEvent) => {
    if (!greeted && event.type !== "error" && event.type !== "response") return;
    connection.send(encodeEvent(event));
  };
  const respond = (id: string, success: boolean, error?: string, result?: unknown) => {
    if (error) {
      connection.send(encodeEvent({ type: "response", id, success, error }));
      return;
    }
    connection.send(
      encodeEvent(result === undefined ? { type: "response", id, success } : { type: "response", id, success, result }),
    );
  };

  const handshake = (command: Extract<BridgeCommand, { type: "hello" }>) => {
    if (command.token !== options.token) {
      connection.close(4401, "unauthorized");
      return;
    }
    if (command.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
      connection.close(4426, "protocol version mismatch");
      return;
    }
    greeted = true;
    respond(command.id, true);
    const greeting = options.greeting?.();
    if (greeting) emit(greeting);
  };

  return {
    emit,
    async handleFrame(raw: string): Promise<void> {
      let command: BridgeCommand;
      try {
        command = decodeCommand(raw);
      } catch (error) {
        const message = (error as Error).message;
        connection.send(encodeEvent({ type: "error", message }));
        // A command this host does not know — an app newer than its container image — must not leave the caller's
        // request pending until its timeout, which reads as a hung session rather than a version mismatch.
        const id = pendingId(raw);
        if (id) respond(id, false, message);
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
        const result = await options.dispatch(command);
        respond(command.id, true, undefined, result);
      } catch (error) {
        respond(command.id, false, (error as Error).message);
      }
    },
  };
}
