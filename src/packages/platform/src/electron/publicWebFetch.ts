import type { LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import type { ResolvedFetch } from "@/ai-system/adapters/webSearch";

function closeAfterBody(response: Response, dispatcher: Agent): Response {
  if (!response.body) {
    void dispatcher.close();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await dispatcher.close();
        } else if (chunk.value) {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        await dispatcher.close().catch(() => undefined);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createElectronPublicWebFetch(): ResolvedFetch {
  return async (url, addresses, init) => {
    if (addresses.length === 0) throw new Error("AI: no validated public address available");
    const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(addresses) } });
    try {
      const requestInit = { ...init, dispatcher } as Parameters<typeof undiciFetch>[1];
      const response = await undiciFetch(url, requestInit);
      return closeAfterBody(response as unknown as Response, dispatcher);
    } catch (error) {
      await dispatcher.close().catch(() => undefined);
      throw error;
    }
  };
}

export function createPinnedLookup(addresses: string[]): LookupFunction {
  const records = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  return (_hostname, options, callback) => {
    const eligible = options.family ? records.filter((record) => record.family === options.family) : records;
    const selected = eligible[0] ?? records[0];
    if (options.all) callback(null, eligible.length > 0 ? eligible : records);
    else callback(null, selected.address, selected.family);
  };
}
