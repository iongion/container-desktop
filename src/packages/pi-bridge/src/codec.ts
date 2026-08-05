import {
  BRIDGE_COMMAND_TYPES,
  BRIDGE_EVENT_TYPES,
  type BridgeCommand,
  type BridgeEvent,
  BridgeProtocolError,
} from "@/pi-bridge/protocol";

// JSON text frames, not CBOR: frames are small, both ends are JS, and a readable frame is worth more
// during live debugging than the bytes saved. Shape checks stay shallow — the consumer owns payload
// semantics, the codec owns "is this a frame of a known kind".
function parse(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new BridgeProtocolError(`malformed frame: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BridgeProtocolError("frame is not an object");
  }
  return value as Record<string, unknown>;
}

export function encodeCommand(command: BridgeCommand): string {
  return JSON.stringify(command);
}

export function decodeCommand(raw: string): BridgeCommand {
  const frame = parse(raw);
  const type = frame.type;
  if (typeof type !== "string" || !BRIDGE_COMMAND_TYPES.has(type)) {
    throw new BridgeProtocolError(`unknown command type: ${String(type)}`);
  }
  if (typeof frame.id !== "string" || frame.id.length === 0) {
    throw new BridgeProtocolError(`command ${type} is missing an id`);
  }
  return frame as unknown as BridgeCommand;
}

export function encodeEvent(event: BridgeEvent): string {
  return JSON.stringify(event);
}

export function decodeEvent(raw: string): BridgeEvent {
  const frame = parse(raw);
  const type = frame.type;
  if (typeof type !== "string" || !BRIDGE_EVENT_TYPES.has(type)) {
    throw new BridgeProtocolError(`unknown event type: ${String(type)}`);
  }
  return frame as unknown as BridgeEvent;
}
