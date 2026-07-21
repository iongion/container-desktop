import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { ListedModel, ProviderTransport } from "@/ai-system/core/types";

interface DiscoveryRecord {
  senderId: number | string;
  controller: AbortController;
}

export interface ModelDiscoveryHostDeps<TEvent> {
  senderId: (event: TEvent) => number | string;
  resolveProviderAccess: (providerId?: string) => Promise<ResolvedProvider>;
  providerTransport: ProviderTransport;
  listModels: (
    provider: ResolvedProvider,
    options: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
}

export function createModelDiscoveryHost<TEvent>(deps: ModelDiscoveryHostDeps<TEvent>) {
  const records = new Map<string, DiscoveryRecord>();
  const abortRequest = (record: DiscoveryRecord) => record.controller.abort(new Error("AI: model discovery cancelled"));

  return {
    async list(event: TEvent, requestId: string, providerId?: string): Promise<{ models: ListedModel[] }> {
      if (records.has(requestId)) throw new Error("AI: model discovery request already exists");
      const controller = new AbortController();
      const record = { senderId: deps.senderId(event), controller };
      records.set(requestId, record);
      try {
        const resolved = await deps.resolveProviderAccess(providerId);
        return {
          models: await deps.listModels(resolved, {
            fetchImpl: createProviderFetch(deps.providerTransport, resolved),
            signal: controller.signal,
          }),
        };
      } finally {
        if (records.get(requestId) === record) records.delete(requestId);
      }
    },
    cancel(event: TEvent, requestId: string): { ok: true } {
      const record = records.get(requestId);
      if (!record || record.senderId !== deps.senderId(event)) {
        throw new Error("AI: model discovery request not found");
      }
      abortRequest(record);
      return { ok: true };
    },
    disposeForSender(senderId: number | string): void {
      for (const [requestId, record] of records) {
        if (record.senderId !== senderId) continue;
        abortRequest(record);
        records.delete(requestId);
      }
    },
    dispose(): void {
      for (const record of records.values()) abortRequest(record);
      records.clear();
    },
  };
}
