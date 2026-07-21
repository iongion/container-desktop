function bytesFromString(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export function toLogBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return bytesFromString(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  const data = (value as any)?.data;
  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }
  return new TextEncoder().encode(`${value ?? ""}`);
}

function isMultiplexedHeader(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes.length >= offset + 8 &&
    (bytes[offset] === 0 || bytes[offset] === 1 || bytes[offset] === 2) &&
    bytes[offset + 1] === 0 &&
    bytes[offset + 2] === 0 &&
    bytes[offset + 3] === 0
  );
}

function frameLength(bytes: Uint8Array, offset: number): number {
  return (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (!left.length) {
    return right;
  }
  if (!right.length) {
    return left;
  }
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

export function decodeContainerLogPayload(value: unknown): string {
  const bytes = toLogBytes(value);
  const decoder = new TextDecoder();
  let offset = 0;
  let detectedFrames = 0;
  const payloads: Uint8Array[] = [];

  while (isMultiplexedHeader(bytes, offset)) {
    const length = frameLength(bytes, offset);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    if (length < 0 || payloadEnd > bytes.length) {
      break;
    }
    payloads.push(bytes.slice(payloadStart, payloadEnd));
    detectedFrames += 1;
    offset = payloadEnd;
  }

  if (!detectedFrames) {
    return decoder.decode(bytes);
  }

  if (offset < bytes.length) {
    payloads.push(bytes.slice(offset));
  }
  return payloads.map((payload) => decoder.decode(payload)).join("");
}

export function createContainerLogDecoder() {
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const decoder = new TextDecoder();

  return {
    push(value: unknown): string {
      pending = concatBytes(pending, toLogBytes(value));
      if (!pending.length) {
        return "";
      }
      if (!isMultiplexedHeader(pending, 0)) {
        const output = decoder.decode(pending);
        pending = new Uint8Array();
        return output;
      }

      const payloads: Uint8Array[] = [];
      let offset = 0;
      while (isMultiplexedHeader(pending, offset)) {
        const length = frameLength(pending, offset);
        const payloadStart = offset + 8;
        const payloadEnd = payloadStart + length;
        if (payloadEnd > pending.length) {
          break;
        }
        payloads.push(pending.slice(payloadStart, payloadEnd));
        offset = payloadEnd;
      }
      pending = pending.slice(offset);
      return payloads.map((payload) => decoder.decode(payload)).join("");
    },
  };
}
